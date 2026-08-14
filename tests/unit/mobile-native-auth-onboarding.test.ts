import { describe, expect, it } from "vitest"
import { AUTH_PASSWORD_MIN_LENGTH as API_PASSWORD_MIN_LENGTH } from "../../apps/api/src/modules/auth/auth.constants"
import {
  AUTH_PASSWORD_MIN_LENGTH,
  PASSWORD_RECOVERY_CODE_LENGTH
} from "../../apps/mobile-native/src/auth/auth-recovery"
import {
  EMAIL_VERIFICATION_CODE_LENGTH,
  EMPTY_ACADEMIC_ONBOARDING_DRAFT,
  buildAcademicSelectionPayload,
  classLevelOptionsForAcademicDepartment,
  hasAcademicOnboardingChanges,
  isPasswordRecoveryCodeComplete,
  isVerificationCodeComplete,
  maskEmail,
  normalizeNumericCode,
  resolveAuthResponsiveContract,
  selectAcademicClassLevel,
  selectAcademicDepartment,
  selectAcademicFaculty,
  selectAcademicUniversity,
  validateLoginForm,
  validateRegistrationForm,
  type AcademicOnboardingDraft
} from "../../apps/mobile-native/src/auth/auth-ui"

const completeDraft: AcademicOnboardingDraft = {
  universityId: "university-1",
  facultyId: "faculty-1",
  departmentId: "department-1",
  classLevel: 4
}

describe("mobile authentication and academic onboarding helpers", () => {
  describe("login and registration validation", () => {
    it("accepts a normalized valid login and requires only a non-empty login password", () => {
      expect(validateLoginForm({
        email: " STUDENT@EXAMPLE.EDU ",
        password: "x"
      })).toEqual({ valid: true, errors: {} })
    })

    it("returns local errors for an invalid login email and empty password", () => {
      expect(validateLoginForm({ email: "student", password: "" })).toEqual({
        valid: false,
        errors: {
          email: "Geçerli bir e-posta adresi gir.",
          password: "Şifre zorunludur."
        }
      })
    })

    it("keeps registration password length in exact parity with the API", () => {
      expect(AUTH_PASSWORD_MIN_LENGTH).toBe(API_PASSWORD_MIN_LENGTH)
      expect(AUTH_PASSWORD_MIN_LENGTH).toBe(8)

      const password = "Abcdef12"
      expect(validateRegistrationForm({
        fullName: "Ada Lovelace",
        email: "ada@example.edu",
        password,
        passwordConfirmation: password
      })).toEqual({
        valid: true,
        errors: {},
        requirements: {
          minimumLength: true,
          uppercase: true,
          lowercase: true,
          digit: true,
          special: false,
          characterGroupCount: 3,
          characterGroupsComplete: true,
          confirmationMatches: true
        }
      })
    })

    it("reports every invalid registration field and an empty confirmation", () => {
      expect(validateRegistrationForm({
        fullName: " A ",
        email: "not-an-email",
        password: "Aa1!234",
        passwordConfirmation: ""
      })).toEqual({
        valid: false,
        errors: {
          fullName: "Ad soyad en az 2 karakter olmalıdır.",
          email: "Geçerli bir e-posta adresi gir.",
          password: "Şifren en az 8 karakter olmalıdır.",
          passwordConfirmation: "Şifre tekrarı zorunludur."
        },
        requirements: {
          minimumLength: false,
          uppercase: true,
          lowercase: true,
          digit: true,
          special: true,
          characterGroupCount: 4,
          characterGroupsComplete: true,
          confirmationMatches: false
        }
      })
    })

    it("distinguishes a mismatched confirmation from a missing confirmation", () => {
      const result = validateRegistrationForm({
        fullName: "Ada Lovelace",
        email: "ada@example.edu",
        password: "Abcdef12",
        passwordConfirmation: "Abcdef13"
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toEqual({ passwordConfirmation: "Şifreler eşleşmiyor." })
      expect(result.requirements).toEqual({
        minimumLength: true,
        uppercase: true,
        lowercase: true,
        digit: true,
        special: false,
        characterGroupCount: 3,
        characterGroupsComplete: true,
        confirmationMatches: false
      })
    })

    it("rejects an eight-character password that satisfies fewer than three character groups", () => {
      expect(validateRegistrationForm({
        fullName: "Ada Lovelace",
        email: "ada@example.edu",
        password: "12345678",
        passwordConfirmation: "12345678"
      })).toMatchObject({
        valid: false,
        errors: {
          password: "Şifren büyük harf, küçük harf, rakam ve özel karakter gruplarından en az üçünü içermelidir."
        },
        requirements: {
          minimumLength: true,
          characterGroupCount: 1,
          characterGroupsComplete: false
        }
      })
    })
  })

  describe("verification and recovery codes", () => {
    it("filters non-digits and clamps numeric codes to the requested length", () => {
      expect(normalizeNumericCode("a1 2-3x4567", EMAIL_VERIFICATION_CODE_LENGTH)).toBe("123456")
      expect(normalizeNumericCode("12", EMAIL_VERIFICATION_CODE_LENGTH)).toBe("12")
      expect(normalizeNumericCode("123", 0)).toBe("")
      expect(normalizeNumericCode("123", -1)).toBe("")
    })

    it("requires exactly six ASCII digits for email verification", () => {
      expect(EMAIL_VERIFICATION_CODE_LENGTH).toBe(6)
      expect(isVerificationCodeComplete("012345")).toBe(true)
      expect(isVerificationCodeComplete("12345")).toBe(false)
      expect(isVerificationCodeComplete("1234567")).toBe(false)
      expect(isVerificationCodeComplete("12a345")).toBe(false)
      expect(isVerificationCodeComplete(" 123456 ")).toBe(false)
    })

    it("requires exactly six ASCII digits for password recovery", () => {
      expect(PASSWORD_RECOVERY_CODE_LENGTH).toBe(6)
      expect(isPasswordRecoveryCodeComplete("012345")).toBe(true)
      expect(isPasswordRecoveryCodeComplete("12345")).toBe(false)
      expect(isPasswordRecoveryCodeComplete("1234567")).toBe(false)
      expect(isPasswordRecoveryCodeComplete("12345x")).toBe(false)
      expect(isPasswordRecoveryCodeComplete(" 123456 ")).toBe(false)
    })
  })

  describe("email masking", () => {
    it("normalizes and masks a multi-character local part while retaining the domain", () => {
      expect(maskEmail(" Student.Name@Example.EDU ")).toBe("s***e@example.edu")
    })

    it("masks a one-character local part without repeating it", () => {
      expect(maskEmail("A@example.edu")).toBe("a***@example.edu")
    })

    it.each(["", "student", "@example.edu", "student@"])(
      "uses a safe destination label for invalid input %j",
      (email) => {
        expect(maskEmail(email)).toBe("e-posta adresin")
      }
    )
  })

  describe("academic hierarchy draft transitions", () => {
    it("starts without invented academic selections", () => {
      expect(EMPTY_ACADEMIC_ONBOARDING_DRAFT).toEqual({
        universityId: "",
        facultyId: "",
        departmentId: "",
        classLevel: null
      })
    })

    it("preserves a reselected university and clears all descendants when it changes", () => {
      expect(selectAcademicUniversity(completeDraft, "university-1")).toBe(completeDraft)
      expect(selectAcademicUniversity(completeDraft, "university-2")).toEqual({
        universityId: "university-2",
        facultyId: "",
        departmentId: "",
        classLevel: null
      })
    })

    it("clears department and class level when faculty changes or is explicitly cleared", () => {
      expect(selectAcademicFaculty(completeDraft, "faculty-2")).toEqual({
        universityId: "university-1",
        facultyId: "faculty-2",
        departmentId: "",
        classLevel: null
      })
      expect(selectAcademicFaculty(completeDraft, null)).toEqual({
        universityId: "university-1",
        facultyId: "",
        departmentId: "",
        classLevel: null
      })

      const alreadyClear = selectAcademicFaculty(completeDraft, null)
      expect(selectAcademicFaculty(alreadyClear, null)).toBe(alreadyClear)
    })

    it("clears class level when department changes or is explicitly cleared", () => {
      expect(selectAcademicDepartment(completeDraft, "department-2")).toEqual({
        universityId: "university-1",
        facultyId: "faculty-1",
        departmentId: "department-2",
        classLevel: null
      })
      expect(selectAcademicDepartment(completeDraft, null)).toEqual({
        universityId: "university-1",
        facultyId: "faculty-1",
        departmentId: "",
        classLevel: null
      })

      const alreadyClear = selectAcademicDepartment(completeDraft, null)
      expect(selectAcademicDepartment(alreadyClear, null)).toBe(alreadyClear)
    })

    it("sets and explicitly clears class level without changing its hierarchy", () => {
      expect(selectAcademicClassLevel(completeDraft, 2)).toEqual({
        ...completeDraft,
        classLevel: 2
      })
      expect(selectAcademicClassLevel(completeDraft, null)).toEqual({
        ...completeDraft,
        classLevel: null
      })
    })
  })

  describe("academic class-level mappings", () => {
    it.each([
      { label: "no department", department: null, maximum: 4 },
      { label: "associate", department: { name: "Bilgisayar Programcılığı", educationLevel: "associate" }, maximum: 2 },
      { label: "master", department: { name: "Yüksek Lisans", educationLevel: "master" }, maximum: 2 },
      { label: "doctorate", department: { name: "Doktora", educationLevel: "doctorate" }, maximum: 4 },
      { label: "standard bachelor", department: { name: "Bilgisayar Mühendisliği", educationLevel: "bachelor" }, maximum: 4 },
      { label: "medicine bachelor", department: { name: "Tıp", educationLevel: "bachelor" }, maximum: 6 },
      { label: "dentistry bachelor", department: { name: "Diş Hekimliği", educationLevel: "bachelor" }, maximum: 5 },
      { label: "pharmacy bachelor", department: { name: "Eczacılık", educationLevel: "bachelor" }, maximum: 5 },
      { label: "veterinary bachelor", department: { name: "Veterinerlik", educationLevel: "bachelor" }, maximum: 5 }
    ])("maps $label to levels 1-$maximum", ({ department, maximum }) => {
      const options = classLevelOptionsForAcademicDepartment(department)

      expect(options).toHaveLength(maximum)
      expect(options).toEqual(Array.from({ length: maximum }, (_, index) => ({
        value: index + 1,
        label: `${index + 1}. sınıf`
      })))
    })
  })

  describe("academic payload and dirty-state rules", () => {
    it("requires a university and omits stale descendants when their parent is absent", () => {
      expect(buildAcademicSelectionPayload({
        universityId: "",
        facultyId: "faculty-stale",
        departmentId: "department-stale",
        classLevel: 2
      })).toBeNull()

      expect(buildAcademicSelectionPayload({
        universityId: "university-1",
        facultyId: "",
        departmentId: "department-stale",
        classLevel: null
      })).toEqual({ universityId: "university-1" })
    })

    it("emits only selected optional fields and preserves a real class-level choice", () => {
      expect(buildAcademicSelectionPayload({
        universityId: "university-1",
        facultyId: "faculty-1",
        departmentId: "",
        classLevel: null
      })).toEqual({
        universityId: "university-1",
        facultyId: "faculty-1"
      })

      expect(buildAcademicSelectionPayload(completeDraft)).toEqual({
        universityId: "university-1",
        facultyId: "faculty-1",
        departmentId: "department-1",
        classLevel: 4
      })
    })

    it("detects changes to every academic field and treats equal drafts as clean", () => {
      expect(hasAcademicOnboardingChanges(completeDraft, { ...completeDraft })).toBe(false)
      expect(hasAcademicOnboardingChanges(completeDraft, { ...completeDraft, universityId: "university-2" })).toBe(true)
      expect(hasAcademicOnboardingChanges(completeDraft, { ...completeDraft, facultyId: "faculty-2" })).toBe(true)
      expect(hasAcademicOnboardingChanges(completeDraft, { ...completeDraft, departmentId: "department-2" })).toBe(true)
      expect(hasAcademicOnboardingChanges(completeDraft, { ...completeDraft, classLevel: 3 })).toBe(true)
    })
  })

  describe("responsive auth contract", () => {
    it("keeps a 320dp iOS form compact, keyboard-safe, and system-scalable at 200%", () => {
      expect(resolveAuthResponsiveContract({
        platform: "ios",
        windowWidth: 320,
        fontScale: 2
      })).toEqual({
        compact: true,
        contentGap: 12,
        keyboardBehavior: "padding",
        textScalePolicy: "system-unbounded",
        horizontalScrollingAllowed: false
      })
    })

    it("uses Android keyboard height behavior without disabling 200% text scaling", () => {
      expect(resolveAuthResponsiveContract({
        platform: "android",
        windowWidth: 375,
        fontScale: 2
      })).toEqual({
        compact: false,
        contentGap: 16,
        keyboardBehavior: "height",
        textScalePolicy: "system-unbounded",
        horizontalScrollingAllowed: false
      })
    })

    it("fails invalid width measurements closed to the compact layout", () => {
      expect(resolveAuthResponsiveContract({
        platform: "android",
        windowWidth: Number.NaN,
        fontScale: 1
      })).toMatchObject({ compact: true, contentGap: 12 })
      expect(resolveAuthResponsiveContract({
        platform: "android",
        windowWidth: Number.POSITIVE_INFINITY,
        fontScale: 3
      })).toMatchObject({ compact: true, contentGap: 12 })
    })
  })
})
