$ErrorActionPreference = "Stop"

$base = "http://localhost:3000"
$seed = [guid]::NewGuid().ToString("N").Substring(0, 8)
$email = "e2e.$seed@ogrenci.edu.tr"
$password = "StrongPass!234"
$deviceId = "e2e-device-$seed"

$universities = Invoke-RestMethod -Uri "$base/universities?limit=20&offset=0"
if (-not $universities -or $universities.Count -eq 0) {
  throw "No universities available for E2E scenario."
}

$universityId = $universities[0].id
$faculties = Invoke-RestMethod -Uri "$base/universities/$universityId/faculties"
if (-not $faculties -or $faculties.Count -eq 0) {
  throw "No faculties available for university $universityId."
}

$facultyId = $faculties[0].id
$departments = Invoke-RestMethod -Uri "$base/faculties/$facultyId/departments"
if (-not $departments -or $departments.Count -eq 0) {
  throw "No departments available for faculty $facultyId."
}

$departmentId = $departments[0].id

$register = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType "application/json" -Body (@{
  fullName = "E2E Student"
  email = $email
  password = $password
  deviceId = $deviceId
  universityId = $universityId
  facultyId = $facultyId
  departmentId = $departmentId
} | ConvertTo-Json)

if ($register.status -ne "verification_required") {
  throw "Registration did not return verification_required status."
}

if (-not $register.previewVerificationToken) {
  throw "No previewVerificationToken returned. Ensure non-production environment for smoke test."
}

$verifiedSession = Invoke-RestMethod -Uri "$base/auth/verify-email" -Method Post -ContentType "application/json" -Body (@{
  token = $register.previewVerificationToken
  deviceId = $deviceId
} | ConvertTo-Json)

$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body (@{
  email = $email
  password = $password
  deviceId = $deviceId
} | ConvertTo-Json)

$refresh = Invoke-RestMethod -Uri "$base/auth/refresh-token" -Method Post -ContentType "application/json" -Body (@{
  refreshToken = $login.refreshToken
  deviceId = $deviceId
} | ConvertTo-Json)

$authHeaders = @{ Authorization = "Bearer $($refresh.accessToken)" }

$myProfile = Invoke-RestMethod -Uri "$base/me/university" -Method Patch -Headers $authHeaders -ContentType "application/json" -Body (@{
  universityId = $universityId
  facultyId = $facultyId
  departmentId = $departmentId
  classLevel = 2
} | ConvertTo-Json)

$myCalendar = Invoke-RestMethod -Uri "$base/calendar/my" -Headers $authHeaders
$upcoming = Invoke-RestMethod -Uri "$base/calendar/upcoming?limit=5" -Headers $authHeaders
$prefsBefore = Invoke-RestMethod -Uri "$base/notification-preferences" -Headers $authHeaders

$prefsAfter = Invoke-RestMethod -Uri "$base/notification-preferences" -Method Patch -Headers $authHeaders -ContentType "application/json" -Body (@{
  enabled = $true
  categories = @{
    course_registration = $true
    midterm_exam = $true
    final_exam = $true
    holiday = $false
  }
  reminderOffsets = @(7, 3, 1)
  quietHours = @{
    enabled = $true
    start = "22:00"
    end = "07:00"
    timezone = "Europe/Istanbul"
  }
} | ConvertTo-Json -Depth 8)

$deviceToken = "web-e2e-token-$seed-abcdef1234567890"
$device = Invoke-RestMethod -Uri "$base/devices/register" -Method Post -Headers $authHeaders -ContentType "application/json" -Body (@{
  platform = "web"
  token = $deviceToken
} | ConvertTo-Json)

$logout = Invoke-RestMethod -Uri "$base/auth/logout" -Method Post -Headers $authHeaders -ContentType "application/json" -Body (@{
  refreshToken = $refresh.refreshToken
} | ConvertTo-Json)

[PSCustomObject]@{
  scenario = "student-e2e-smoke"
  status = "passed"
  userEmail = $email
  userId = $verifiedSession.user.id
  selectedUniversityId = $universityId
  selectedUniversityName = $universities[0].name
  selectedFacultyId = $facultyId
  selectedDepartmentId = $departmentId
  myRole = $verifiedSession.user.role
  calendarStatus = $myCalendar.calendar.status
  myCalendarTitle = $myCalendar.calendar.title
  myEventCount = @($myCalendar.events).Count
  upcomingCount = @($upcoming).Count
  reminderOffsetsBefore = (($prefsBefore.reminderOffsets) -join ",")
  reminderOffsetsAfter = (($prefsAfter.reminderOffsets) -join ",")
  quietHoursEnabled = [bool]$prefsAfter.quietHours.enabled
  deviceRegistrationStatus = $device.status
  logoutStatus = $logout.status
  executedAt = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 8
