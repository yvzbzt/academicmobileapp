export type NotificationPermissionState =
  | "not_requested"
  | "checking"
  | "granted"
  | "denied"
  | "permanently_denied"
  | "unavailable"
  | "error";

export type NotificationRegistrationState =
  | "unregistered"
  | "registering"
  | "registered"
  | "detaching"
  | "error";

export type NotificationLifecycleErrorCode =
  | "owner_mismatch"
  | "permission_inspection_failed"
  | "permission_request_failed"
  | "token_unavailable"
  | "registration_failed"
  | "detach_failed";

export interface NotificationLifecycleState {
  schemaVersion: 1;
  ownerId: string | null;
  preferenceEnabled: boolean;
  permission: NotificationPermissionState;
  registration: NotificationRegistrationState;
  active: boolean;
  errorCode?: NotificationLifecycleErrorCode;
}

export interface NativeNotificationPermissionSnapshot {
  available: boolean;
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
}

export interface NotificationPermissionAdapter {
  inspect(): Promise<NativeNotificationPermissionSnapshot>;
  request(): Promise<NativeNotificationPermissionSnapshot>;
}

export interface NotificationTokenAdapter {
  getToken(): Promise<string>;
  onTokenRefresh(listener: (token: string) => void): () => void;
}

export interface NotificationBackendAdapter {
  registerDevice(input: {
    ownerId: string;
    installationId: string;
    platform: "android" | "ios";
    token: string;
  }): Promise<void>;
  detachDevice(input: {
    ownerId: string;
    installationId: string;
    platform: "android" | "ios";
  }): Promise<void>;
}

export interface NotificationLifecycleCoordinatorOptions {
  installationId: string;
  platform: "android" | "ios";
  permissionAdapter: NotificationPermissionAdapter;
  tokenAdapter: NotificationTokenAdapter;
  backendAdapter: NotificationBackendAdapter;
  initialState?: NotificationLifecycleState;
}

export type NotificationLifecycleListener = (state: NotificationLifecycleState) => void;

type PersistedNotificationLifecycleState = {
  schemaVersion: 1;
  ownerId: string | null;
  preferenceEnabled: boolean;
};

const INITIAL_STATE: NotificationLifecycleState = {
  schemaVersion: 1,
  ownerId: null,
  preferenceEnabled: false,
  permission: "not_requested",
  registration: "unregistered",
  active: false
};

export function mapNotificationPermission(
  snapshot: NativeNotificationPermissionSnapshot,
  requested = false
): NotificationPermissionState {
  if (!snapshot.available) return "unavailable";
  if (snapshot.status === "granted") return "granted";
  if (snapshot.status === "denied") {
    return snapshot.canAskAgain ? "denied" : "permanently_denied";
  }
  return requested ? "denied" : "not_requested";
}

export function isNotificationDeliveryActive(
  state: Pick<NotificationLifecycleState, "preferenceEnabled" | "permission" | "registration">
): boolean {
  return state.preferenceEnabled
    && state.permission === "granted"
    && state.registration === "registered";
}

export function serializeNotificationLifecycleState(state: NotificationLifecycleState): string {
  const persisted: PersistedNotificationLifecycleState = {
    schemaVersion: 1,
    ownerId: state.ownerId,
    preferenceEnabled: state.preferenceEnabled
  };
  return JSON.stringify(persisted);
}

export function parseNotificationLifecycleState(value: string | null | undefined): NotificationLifecycleState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PersistedNotificationLifecycleState>;
    if (
      parsed.schemaVersion !== 1
      || (parsed.ownerId !== null && !isSafeIdentifier(parsed.ownerId))
      || typeof parsed.preferenceEnabled !== "boolean"
    ) {
      return null;
    }
    return buildState({
      ...INITIAL_STATE,
      ownerId: parsed.ownerId,
      preferenceEnabled: parsed.preferenceEnabled
    });
  } catch {
    return null;
  }
}

export class NotificationLifecycleCoordinator {
  private state: NotificationLifecycleState;
  private ownerEpoch = 0;
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<NotificationLifecycleListener>();
  private stopTokenRotation: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly options: NotificationLifecycleCoordinatorOptions) {
    if (!isSafeIdentifier(options.installationId)) {
      throw new Error("A valid notification installation ID is required.");
    }
    this.state = buildState(options.initialState ?? INITIAL_STATE);
  }

  getState(): NotificationLifecycleState {
    return { ...this.state };
  }

  subscribe(listener: NotificationLifecycleListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  activateOwner(ownerId: string, preferenceEnabled: boolean): Promise<NotificationLifecycleState> {
    if (!isSafeIdentifier(ownerId)) throw new Error("A valid notification owner ID is required.");
    const previousOwnerId = this.state.ownerId;
    this.ownerEpoch += 1;
    this.replaceState({
      ...INITIAL_STATE,
      ownerId,
      preferenceEnabled
    });

    if (previousOwnerId) {
      return this.enqueue(async () => {
        const detached = await this.detachOwner(previousOwnerId, false);
        if (!detached && this.state.ownerId === ownerId) {
          this.patchState({ registration: "error", errorCode: "detach_failed" });
        }
      });
    }
    return Promise.resolve(this.getState());
  }

  clearOwner(): Promise<NotificationLifecycleState> {
    const previousOwnerId = this.state.ownerId;
    this.ownerEpoch += 1;
    this.replaceState(INITIAL_STATE);
    if (!previousOwnerId) return Promise.resolve(this.getState());
    return this.enqueue(async () => {
      const detached = await this.detachOwner(previousOwnerId, false);
      if (!detached && this.state.ownerId === null) {
        this.patchState({ registration: "error", errorCode: "detach_failed" });
      }
    });
  }

  setPreferenceEnabled(enabled: boolean): Promise<NotificationLifecycleState> {
    if (enabled) {
      this.patchState({ preferenceEnabled: true });
      return Promise.resolve(this.getState());
    }

    const ownerId = this.state.ownerId;
    this.ownerEpoch += 1;
    const epoch = this.ownerEpoch;
    this.patchState({
      preferenceEnabled: false,
      registration: ownerId ? "detaching" : "unregistered"
    });
    if (!ownerId) return Promise.resolve(this.getState());
    return this.enqueue(async () => {
      const detached = await this.detachOwner(ownerId, true);
      if (detached && this.isCurrent(ownerId, epoch)) {
        this.patchState({ registration: "unregistered" });
      }
    });
  }

  inspectPermission(): Promise<NotificationLifecycleState> {
    const epoch = this.ownerEpoch;
    const ownerId = this.state.ownerId;
    this.patchState({ permission: "checking" });
    return this.enqueue(async () => {
      try {
        const snapshot = await this.options.permissionAdapter.inspect();
        if (!this.isCurrent(ownerId, epoch)) return;
        this.patchState({ permission: mapNotificationPermission(snapshot) });
      } catch {
        if (!this.isCurrent(ownerId, epoch)) return;
        this.patchState({
          permission: "error",
          errorCode: "permission_inspection_failed"
        });
      }
    });
  }

  registerIfAlreadyGranted(): Promise<NotificationLifecycleState> {
    const epoch = this.ownerEpoch;
    const ownerId = this.state.ownerId;
    return this.enqueue(async () => {
      try {
        const snapshot = await this.options.permissionAdapter.inspect();
        if (!this.isCurrent(ownerId, epoch)) return;
        const permission = mapNotificationPermission(snapshot);
        this.patchState({ permission });
        if (permission === "granted" && ownerId && this.state.preferenceEnabled) {
          await this.registerOwner(ownerId, epoch);
        } else if (ownerId) {
          this.patchState({ registration: "detaching" });
          const detached = await this.detachOwner(ownerId, true);
          if (detached && this.isCurrent(ownerId, epoch)) {
            this.patchState({ registration: "unregistered" });
          }
        }
      } catch {
        if (!this.isCurrent(ownerId, epoch)) return;
        this.patchState({
          permission: "error",
          errorCode: "permission_inspection_failed"
        });
      }
    });
  }

  enableAfterUserIntent(input: {
    ownerId: string;
    intent: "enable_notifications";
  }): Promise<NotificationLifecycleState> {
    if (input.intent !== "enable_notifications") {
      throw new Error("Notification permission requires explicit user intent.");
    }
    if (this.state.ownerId !== input.ownerId) {
      this.patchState({ errorCode: "owner_mismatch" });
      return Promise.resolve(this.getState());
    }

    const epoch = this.ownerEpoch;
    this.patchState({ preferenceEnabled: true, permission: "checking" });
    return this.enqueue(async () => {
      let snapshot: NativeNotificationPermissionSnapshot;
      try {
        snapshot = await this.options.permissionAdapter.inspect();
      } catch {
        if (this.isCurrent(input.ownerId, epoch)) {
          this.patchState({ permission: "error", errorCode: "permission_inspection_failed" });
        }
        return;
      }
      if (!this.isCurrent(input.ownerId, epoch)) return;

      let permission = mapNotificationPermission(snapshot);
      if (permission === "not_requested" || permission === "denied") {
        try {
          snapshot = await this.options.permissionAdapter.request();
          permission = mapNotificationPermission(snapshot, true);
        } catch {
          if (this.isCurrent(input.ownerId, epoch)) {
            this.patchState({ permission: "error", errorCode: "permission_request_failed" });
          }
          return;
        }
      }
      if (!this.isCurrent(input.ownerId, epoch)) return;
      this.patchState({ permission });
      if (permission === "granted") {
        await this.registerOwner(input.ownerId, epoch);
      } else {
        this.patchState({ registration: "detaching" });
        const detached = await this.detachOwner(input.ownerId, true);
        if (detached && this.isCurrent(input.ownerId, epoch)) {
          this.patchState({ registration: "unregistered" });
        }
      }
    });
  }

  detachCurrentOwner(): Promise<NotificationLifecycleState> {
    const ownerId = this.state.ownerId;
    if (!ownerId) return Promise.resolve(this.getState());
    this.ownerEpoch += 1;
    const epoch = this.ownerEpoch;
    this.patchState({ registration: "detaching" });
    return this.enqueue(async () => {
      const detached = await this.detachOwner(ownerId, true);
      if (detached && this.isCurrent(ownerId, epoch)) {
        this.patchState({ registration: "unregistered" });
      }
    });
  }

  startTokenRotationListener(): () => void {
    if (this.stopTokenRotation) return this.stopTokenRotation;
    const unsubscribe = this.options.tokenAdapter.onTokenRefresh((token) => {
      const ownerId = this.state.ownerId;
      const epoch = this.ownerEpoch;
      if (
        !ownerId
        || !this.state.preferenceEnabled
        || this.state.permission !== "granted"
        || this.disposed
      ) {
        return;
      }
      void this.enqueue(async () => {
        await this.registerOwnerWithToken(ownerId, epoch, token);
      });
    });
    this.stopTokenRotation = () => {
      unsubscribe();
      this.stopTokenRotation = null;
    };
    return this.stopTokenRotation;
  }

  dispose(): void {
    this.disposed = true;
    this.ownerEpoch += 1;
    this.stopTokenRotation?.();
    this.listeners.clear();
  }

  private async registerOwner(ownerId: string, epoch: number): Promise<void> {
    if (!this.isCurrent(ownerId, epoch)) return;
    this.patchState({ registration: "registering" });
    let token: string;
    try {
      token = (await this.options.tokenAdapter.getToken()).trim();
    } catch {
      if (this.isCurrent(ownerId, epoch)) {
        this.patchState({ registration: "error", errorCode: "token_unavailable" });
      }
      return;
    }
    if (!token) {
      if (this.isCurrent(ownerId, epoch)) {
        this.patchState({ registration: "error", errorCode: "token_unavailable" });
      }
      return;
    }
    await this.registerOwnerWithToken(ownerId, epoch, token);
  }

  private async registerOwnerWithToken(ownerId: string, epoch: number, token: string): Promise<void> {
    if (!this.isCurrent(ownerId, epoch)) return;
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      this.patchState({ registration: "error", errorCode: "token_unavailable" });
      return;
    }
    this.patchState({ registration: "registering" });
    try {
      await this.options.backendAdapter.registerDevice({
        ownerId,
        installationId: this.options.installationId,
        platform: this.options.platform,
        token: normalizedToken
      });
      if (!this.isCurrent(ownerId, epoch)) {
        await this.detachOwner(ownerId, false);
        return;
      }
      this.patchState({ registration: "registered" });
    } catch {
      if (!this.isCurrent(ownerId, epoch)) return;
      this.patchState({ registration: "error", errorCode: "registration_failed" });
    }
  }

  private async detachOwner(ownerId: string, reportFailure: boolean): Promise<boolean> {
    try {
      await this.options.backendAdapter.detachDevice({
        ownerId,
        installationId: this.options.installationId,
        platform: this.options.platform
      });
      return true;
    } catch {
      if (reportFailure && this.state.ownerId === ownerId) {
        this.patchState({ registration: "error", errorCode: "detach_failed" });
      }
      return false;
    }
  }

  private enqueue(action: () => Promise<void>): Promise<NotificationLifecycleState> {
    const operation = this.operationQueue.then(action, action);
    this.operationQueue = operation.catch(() => undefined);
    return operation.then(() => this.getState());
  }

  private isCurrent(ownerId: string | null, epoch: number): boolean {
    return !this.disposed
      && this.ownerEpoch === epoch
      && this.state.ownerId === ownerId;
  }

  private replaceState(state: NotificationLifecycleState): void {
    this.state = buildState(state);
    this.emit();
  }

  private patchState(patch: Partial<NotificationLifecycleState>): void {
    const { errorCode: _previousError, ...withoutError } = this.state;
    this.state = buildState({
      ...withoutError,
      ...patch
    });
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function buildState(state: Omit<NotificationLifecycleState, "active"> & { active?: boolean }): NotificationLifecycleState {
  const next: NotificationLifecycleState = {
    ...state,
    active: isNotificationDeliveryActive(state)
  };
  return next;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
