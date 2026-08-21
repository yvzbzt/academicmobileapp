import { NavigationContainer } from "@react-navigation/native";
import {
  act,
  cleanup,
  fireEvent,
  renderAsync,
  screen,
} from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountGenerationGuard } from "../../src/auth/session-integrity";
import { CalendarEventDetail } from "../../src/calendar/CalendarEventDetail";
import { CalendarExperience } from "../../src/calendar/CalendarExperience";
import { buildCalendarItems } from "../../src/calendar/calendar-model";
import { PersonalExamRuntime } from "../../src/calendar/personal-exam-runtime";
import {
  createManualExamStorageKey,
  serializeManualExamEnvelope,
  type ManualExamRecord,
} from "../../src/session-integrity/manual-exam-storage";
import { ThemeProvider } from "../../src/design-system";
import { DeterministicSecureStoreAdapter } from "./personal-exam-test-adapter";

jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return { ...actual, useScrollToTop: jest.fn() };
});

const OWNER_ID = "cancel-owner";
const ORIGINAL_EXAM: ManualExamRecord = {
  id: "original-exam",
  title: "Lineer Cebir",
  examDate: new Date(2028, 1, 29, 9, 0).toISOString(),
};

async function createHarness(exams: readonly ManualExamRecord[] = []) {
  const storage = new DeterministicSecureStoreAdapter();
  storage.seed(
    createManualExamStorageKey(OWNER_ID),
    serializeManualExamEnvelope(OWNER_ID, exams, "2026-08-05T09:00:00.000Z"),
  );
  const guard = new AccountGenerationGuard();
  const ownerSnapshot = guard.activate(OWNER_ID);
  const runtime = new PersonalExamRuntime({
    storage,
    ownerGuard: guard,
    createId: () => "cancel-created-exam",
    now: () => "2026-08-05T09:00:00.000Z",
  });
  await runtime.hydrate(OWNER_ID, ownerSnapshot);
  storage.clearOperations();
  return { guard, ownerSnapshot, runtime, storage };
}

async function renderCalendar(runtime: PersonalExamRuntime) {
  return renderAsync(
    <SafeAreaProvider>
      <ThemeProvider preference="light">
        <NavigationContainer>
          <CalendarExperience
            academicEvents={[]}
            attempted
            google={{ state: "disconnected", stateLabel: "Bağlı değil" }}
            initialAnchorDate="2028-02-29"
            now={new Date("2028-02-20T09:00:00.000+03:00")}
            onCreatePersonalExam={(input) => runtime.create(input)}
            onManageGoogle={() => undefined}
            onOpenItem={() => undefined}
            onRefresh={() => undefined}
            onSyncGoogle={() => undefined}
            onUpdatePersonalExam={(id, input) => runtime.update(id, input)}
            personalExams={runtime.getSnapshot().exams}
            personalExamsReady
          />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe("Phase 9 personal-exam cancellation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    cleanup();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("cancels new-exam entry with no append, storage write, or visible-list change", async () => {
    const { runtime, storage } = await createHarness([ORIGINAL_EXAM]);
    await renderCalendar(runtime);
    fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinlik ekle" }));
    fireEvent.changeText(screen.getByLabelText("Etkinlik adı"), "Kaydedilmemesi gereken sınav");
    fireEvent.press(screen.getByRole("button", { name: "Vazgeç" }));
    confirmDiscard();
    await runtime.waitForIdle();

    expect(runtime.getSnapshot().exams).toEqual([ORIGINAL_EXAM]);
    expect(storage.operations).toEqual([]);
    expect(screen.getByText("Lineer Cebir")).toBeOnTheScreen();
    expect(screen.queryByText("Kaydedilmemesi gereken sınav")).not.toBeOnTheScreen();
  });

  it("cancels edit with the original record unchanged, no write, and original relaunch restore", async () => {
    const { runtime, storage } = await createHarness([ORIGINAL_EXAM]);
    const [item] = buildCalendarItems({
      academicEvents: [],
      personalExams: runtime.getSnapshot().exams,
      academicSourceLabel: "Resmî kaynak",
    });
    await renderAsync(
      <SafeAreaProvider>
        <ThemeProvider preference="light">
          <CalendarEventDetail
            item={item}
            onDeletePersonalExam={(id) => runtime.delete(id)}
            onUpdatePersonalExam={(id, input) => runtime.update(id, input)}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinliği düzenle" }));
    fireEvent.changeText(screen.getByLabelText("Etkinlik adı"), "Değiştirilmemesi gereken ad");
    fireEvent.press(screen.getByRole("button", { name: "Vazgeç" }));
    confirmDiscard();
    await runtime.waitForIdle();

    expect(runtime.getSnapshot().exams).toEqual([ORIGINAL_EXAM]);
    expect(storage.operations).toEqual([]);

    const relaunchedGuard = new AccountGenerationGuard();
    const relaunchedSnapshot = relaunchedGuard.activate(OWNER_ID);
    const relaunchedRuntime = new PersonalExamRuntime({
      storage,
      ownerGuard: relaunchedGuard,
      createId: () => "unused",
    });
    await relaunchedRuntime.hydrate(OWNER_ID, relaunchedSnapshot);
    expect(relaunchedRuntime.getSnapshot().exams).toEqual([ORIGINAL_EXAM]);
  });

  it("dismisses the native date picker without changing draft, runtime, or storage", async () => {
    const { runtime, storage } = await createHarness();
    await renderCalendar(runtime);
    fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinlik ekle" }));
    fireEvent.press(screen.getByRole("button", { name: "Tarih seçilmedi" }));
    fireEvent(screen.getByLabelText("Sistem tarih seçici"), "change", { type: "dismissed" });
    expect(screen.getByRole("button", { name: "Tarih seçilmedi" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("Tarih seçici açık")).not.toBeOnTheScreen();
    expect(runtime.getSnapshot().exams).toEqual([]);
    expect(storage.operations).toEqual([]);
  });

  it("dismisses the native time picker without changing draft, runtime, or storage", async () => {
    const { runtime, storage } = await createHarness();
    await renderCalendar(runtime);
    fireEvent.press(screen.getByRole("button", { name: "Kişisel etkinlik ekle" }));
    fireEvent.press(screen.getByRole("button", { name: "Saat seçilmedi" }));
    fireEvent(screen.getByLabelText("Sistem saat seçici"), "change", { type: "dismissed" });
    expect(screen.getByRole("button", { name: "Saat seçilmedi" })).toBeOnTheScreen();
    expect(screen.queryByLabelText("Saat seçici açık")).not.toBeOnTheScreen();
    expect(runtime.getSnapshot().exams).toEqual([]);
    expect(storage.operations).toEqual([]);
  });
});

function confirmDiscard() {
  const alertMock = jest.mocked(Alert.alert);
  const latestCall = alertMock.mock.calls[alertMock.mock.calls.length - 1];
  expect(latestCall?.[0]).toBe("Değişiklikler kaydedilmedi");
  const discard = latestCall?.[2]?.find((action) => action.text === "Değişikliklerden vazgeç");
  expect(discard).toBeDefined();
  act(() => {
    discard?.onPress?.();
  });
}
