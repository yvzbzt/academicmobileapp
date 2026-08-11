import {
  AUTH_PASSWORD_MIN_LENGTH,
  PASSWORD_RECOVERY_CODE_LENGTH,
  evaluateAuthPassword,
  isValidPasswordRecoveryEmail,
} from "./auth-recovery";

export const EMAIL_VERIFICATION_CODE_LENGTH = 4;

export interface LoginValidationResult {
  valid: boolean;
  errors: {
    email?: string;
    password?: string;
  };
}

export interface RegistrationValidationResult {
  valid: boolean;
  errors: {
    fullName?: string;
    email?: string;
    password?: string;
    passwordConfirmation?: string;
  };
  requirements: {
    minimumLength: boolean;
    uppercase: boolean;
    lowercase: boolean;
    digit: boolean;
    special: boolean;
    characterGroupCount: number;
    characterGroupsComplete: boolean;
    confirmationMatches: boolean;
  };
}

export function validateLoginForm(input: {
  email: string;
  password: string;
}): LoginValidationResult {
  const errors: LoginValidationResult["errors"] = {};
  if (!isValidPasswordRecoveryEmail(input.email)) {
    errors.email = "Ge\u00e7erli bir e-posta adresi gir.";
  }
  if (input.password.length === 0) {
    errors.password = "\u015eifre zorunludur.";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateRegistrationForm(input: {
  fullName: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}): RegistrationValidationResult {
  const errors: RegistrationValidationResult["errors"] = {};
  const normalizedName = input.fullName.trim();
  const passwordRequirements = evaluateAuthPassword(input.password);
  const confirmationMatches = input.passwordConfirmation.length > 0
    && input.password === input.passwordConfirmation;

  if (normalizedName.length < 2) {
    errors.fullName = "Ad soyad en az 2 karakter olmal\u0131d\u0131r.";
  }
  if (!isValidPasswordRecoveryEmail(input.email)) {
    errors.email = "Ge\u00e7erli bir e-posta adresi gir.";
  }
  if (!passwordRequirements.minimumLength) {
    errors.password = `\u015eifren en az ${AUTH_PASSWORD_MIN_LENGTH} karakter olmal\u0131d\u0131r.`;
  } else if (!passwordRequirements.characterGroupsComplete) {
    errors.password = "Şifren büyük harf, küçük harf, rakam ve özel karakter gruplarından en az üçünü içermelidir.";
  }
  if (!confirmationMatches) {
    errors.passwordConfirmation = input.passwordConfirmation.length === 0
      ? "\u015eifre tekrar\u0131 zorunludur."
      : "\u015eifreler e\u015fle\u015fmiyor.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    requirements: { ...passwordRequirements, confirmationMatches },
  };
}

export function normalizeNumericCode(value: string, length: number): string {
  return value.replace(/\D/gu, "").slice(0, Math.max(0, length));
}

export function isVerificationCodeComplete(value: string): boolean {
  return new RegExp(`^\\d{${EMAIL_VERIFICATION_CODE_LENGTH}}$`, "u").test(value);
}

export function isPasswordRecoveryCodeComplete(value: string): boolean {
  return new RegExp(`^\\d{${PASSWORD_RECOVERY_CODE_LENGTH}}$`, "u").test(value);
}

export function maskEmail(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("tr-TR");
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return "e-posta adresin";
  const local = normalized.slice(0, separator);
  const domain = normalized.slice(separator + 1);
  if (local.length === 1) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local.at(-1)}@${domain}`;
}

export type AcademicClassLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface AcademicOnboardingDraft {
  universityId: string;
  facultyId: string;
  departmentId: string;
  classLevel: AcademicClassLevel | null;
}

export interface AcademicDepartmentMetadata {
  name: string;
  educationLevel?: string;
}

export const EMPTY_ACADEMIC_ONBOARDING_DRAFT: AcademicOnboardingDraft = {
  universityId: "",
  facultyId: "",
  departmentId: "",
  classLevel: null,
};

export function selectAcademicUniversity(
  draft: AcademicOnboardingDraft,
  universityId: string,
): AcademicOnboardingDraft {
  if (draft.universityId === universityId) return draft;
  return {
    universityId,
    facultyId: "",
    departmentId: "",
    classLevel: null,
  };
}

export function selectAcademicFaculty(
  draft: AcademicOnboardingDraft,
  facultyId: string | null,
): AcademicOnboardingDraft {
  const normalizedFacultyId = facultyId ?? "";
  if (draft.facultyId === normalizedFacultyId && !draft.departmentId && draft.classLevel === null) {
    return draft;
  }
  return {
    ...draft,
    facultyId: normalizedFacultyId,
    departmentId: "",
    classLevel: null,
  };
}

export function selectAcademicDepartment(
  draft: AcademicOnboardingDraft,
  departmentId: string | null,
): AcademicOnboardingDraft {
  const normalizedDepartmentId = departmentId ?? "";
  if (draft.departmentId === normalizedDepartmentId && draft.classLevel === null) return draft;
  return {
    ...draft,
    departmentId: normalizedDepartmentId,
    classLevel: null,
  };
}

export function selectAcademicClassLevel(
  draft: AcademicOnboardingDraft,
  classLevel: AcademicClassLevel | null,
): AcademicOnboardingDraft {
  return { ...draft, classLevel };
}

export function classLevelOptionsForAcademicDepartment(
  department?: AcademicDepartmentMetadata | null,
): ReadonlyArray<{ value: AcademicClassLevel; label: string }> {
  const maximum = maximumClassLevel(department);
  return Array.from({ length: maximum }, (_, index) => {
    const value = (index + 1) as AcademicClassLevel;
    return { value, label: `${value}. s\u0131n\u0131f` };
  });
}

export function buildAcademicSelectionPayload(
  draft: AcademicOnboardingDraft,
): {
  universityId: string;
  facultyId?: string;
  departmentId?: string;
  classLevel?: AcademicClassLevel;
} | null {
  if (!draft.universityId) return null;
  return {
    universityId: draft.universityId,
    ...(draft.facultyId ? { facultyId: draft.facultyId } : {}),
    ...(draft.facultyId && draft.departmentId ? { departmentId: draft.departmentId } : {}),
    ...(draft.classLevel !== null ? { classLevel: draft.classLevel } : {}),
  };
}

export function hasAcademicOnboardingChanges(
  initial: AcademicOnboardingDraft,
  current: AcademicOnboardingDraft,
): boolean {
  return initial.universityId !== current.universityId
    || initial.facultyId !== current.facultyId
    || initial.departmentId !== current.departmentId
    || initial.classLevel !== current.classLevel;
}

export interface AuthResponsiveContract {
  compact: boolean;
  contentGap: 12 | 16;
  keyboardBehavior: "padding" | "height";
  textScalePolicy: "system-unbounded";
  horizontalScrollingAllowed: false;
}

export function resolveAuthResponsiveContract(input: {
  platform: string;
  windowWidth: number;
  fontScale: number;
}): AuthResponsiveContract {
  const compact = !Number.isFinite(input.windowWidth) || input.windowWidth < 375;
  return {
    compact,
    contentGap: compact ? 12 : 16,
    keyboardBehavior: input.platform === "ios" ? "padding" : "height",
    textScalePolicy: "system-unbounded",
    horizontalScrollingAllowed: false,
  };
}

function maximumClassLevel(department?: AcademicDepartmentMetadata | null): number {
  if (!department) return 4;
  if (department.educationLevel === "associate" || department.educationLevel === "master") return 2;
  if (department.educationLevel === "doctorate") return 4;
  if (department.educationLevel !== "bachelor") return 4;
  const name = foldForAcademicMatch(department.name);
  if (/\b(tip|medicine)\b/u.test(name)) return 6;
  if (/\b(dis hekimligi|eczacilik|veteriner|veterinerlik|dentistry|pharmacy|veterinary)\b/u.test(name)) {
    return 5;
  }
  return 4;
}

function foldForAcademicMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\u0131/gu, "i")
    .replace(/[^\p{L}\d]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}
