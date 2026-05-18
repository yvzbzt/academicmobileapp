export const mobileRoutes = {
  auth: ["Splash", "Onboarding", "Login", "Register", "ForgotPassword"],
  selection: ["UniversitySelection", "FacultySelection", "DepartmentSelection", "ClassSelection"],
  mainTabs: ["Home", "Calendar", "Profile"],
  homeStack: ["HomeDashboard", "EventDetail"],
  calendarStack: ["CalendarList", "CalendarMonth", "EventDetail"],
  profileStack: ["Profile", "ChangeUniversity", "NotificationPreferences", "Settings"]
} as const;
