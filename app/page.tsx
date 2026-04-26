"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { supabase } from "./lib/supabase";

type Location = "PF" | "KA";
type EmploymentType =
  | "Vollzeit"
  | "Teilzeit"
  | "Minijob"
  | "Shop Manager"
  | "Praktikant";
type EmploymentFilter = EmploymentType | "Alle";
type ShiftStatus =
  | "ARBEIT"
  | "FREI"
  | "URLAUB"
  | "KRANK"
  | "SCHULUNG"
  | "FEIERTAG";
type EditableShiftStatus = ShiftStatus | "LEER";
type AppTab =
  | "dashboard"
  | "wochenplan"
  | "stempelzeiten"
  | "mitarbeiter"
  | "monatsuebersicht";
type UserRole = "admin" | "mitarbeiter" | null;

type DayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

type Employee = {
  id: string;
  name: string;
  employmentType: EmploymentType;
  vacationDaysTotal: number;
  weeklyTargetHours: number;
};

type Shift = {
  id?: number;
  employeeId: string;
  weekStart: string;
  day: DayKey;
  status: ShiftStatus;
  start: string;
  end: string;
  location: Location;
  note?: string;
};

type WeeklyEdit = {
  status: EditableShiftStatus;
  start: string;
  end: string;
  location: Location;
  note: string;
};

type TimeEntry = {
  id: number;
  employeeId: string;
  entryDate: string;
  clockIn: string;
  clockOut: string;
  manualOverride: boolean;
  reason: string;
};

type VacationSummary = {
  total: number;
  used: number;
  remaining: number;
};

const FEIERTAG_HOURS = 6.67;
const FEIERTAG_MINUTES = FEIERTAG_HOURS * 60;

const dayLabels: Record<DayKey, string> = {
  monday: "Montag",
  tuesday: "Dienstag",
  wednesday: "Mittwoch",
  thursday: "Donnerstag",
  friday: "Freitag",
  saturday: "Samstag",
  sunday: "Sonntag",
};

const dayOrder: DayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function toIsoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCurrentMondayIso() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return toIsoDate(monday);
}

function getTodayIso() {
  return toIsoDate(new Date());
}

function getCurrentTimeHHMM() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function getCurrentMonthPrefix() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function shiftIsoDate(isoDate: string, days: number) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getBWHolidayMap(year: number) {
  const easter = getEasterSunday(year);
  const holidays: Record<string, string> = {};

  holidays[`${year}-01-01`] = "Neujahr";
  holidays[`${year}-01-06`] = "Heilige Drei Könige";
  holidays[toIsoDate(addDays(easter, -2))] = "Karfreitag";
  holidays[toIsoDate(addDays(easter, 1))] = "Ostermontag";
  holidays[`${year}-05-01`] = "Tag der Arbeit";
  holidays[toIsoDate(addDays(easter, 39))] = "Christi Himmelfahrt";
  holidays[toIsoDate(addDays(easter, 50))] = "Pfingstmontag";
  holidays[toIsoDate(addDays(easter, 60))] = "Fronleichnam";
  holidays[`${year}-10-03`] = "Tag der Deutschen Einheit";
  holidays[`${year}-11-01`] = "Allerheiligen";
  holidays[`${year}-12-25`] = "1. Weihnachtstag";
  holidays[`${year}-12-26`] = "2. Weihnachtstag";

  return holidays;
}

function getHolidayName(dateIso: string) {
  if (!dateIso) return null;
  const year = Number(dateIso.slice(0, 4));
  return getBWHolidayMap(year)[dateIso] ?? null;
}

function getSpecialDayLabel(dateIso: string, day: DayKey) {
  const holidayName = getHolidayName(dateIso);
  const isSunday = day === "sunday";

  if (holidayName && isSunday) return `${holidayName} / Sonntag`;
  if (holidayName) return holidayName;
  if (isSunday) return "Sonntag";
  return "";
}

function emptyEdit(): WeeklyEdit {
  return {
    status: "LEER",
    start: "10:00",
    end: "18:00",
    location: "PF",
    note: "",
  };
}

function getDefaultEditForDate(dateIso: string, day: DayKey): WeeklyEdit {
  const holidayName = getHolidayName(dateIso);

  if (holidayName) {
    return {
      status: "FEIERTAG",
      start: "10:00",
      end: "18:00",
      location: "PF",
      note: holidayName,
    };
  }

  if (day === "sunday") {
    return {
      status: "FREI",
      start: "10:00",
      end: "18:00",
      location: "PF",
      note: "Sonntag",
    };
  }

  return emptyEdit();
}

function csvEscape(value: string | number | boolean | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getIsoWeekInfo(date: Date) {
  const copy = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return {
    year: copy.getUTCFullYear(),
    week,
  };
}

function getWeekInputValueFromMondayIso(mondayIso: string) {
  if (!mondayIso) return "";
  const [year, month, day] = mondayIso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const { year: isoYear, week } = getIsoWeekInfo(date);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function getMondayIsoFromWeekInput(weekValue: string) {
  if (!weekValue) return getCurrentMondayIso();

  const [yearPart, weekPart] = weekValue.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);

  if (!year || !week) return getCurrentMondayIso();

  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const firstMonday = new Date(jan4);
  firstMonday.setDate(jan4.getDate() - jan4Day + 1);

  const targetMonday = new Date(firstMonday);
  targetMonday.setDate(firstMonday.getDate() + (week - 1) * 7);

  return toIsoDate(targetMonday);
}

function getCalendarWeekLabelFromMondayIso(mondayIso: string) {
  if (!mondayIso) return "";
  const [year, month, day] = mondayIso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const { year: isoYear, week } = getIsoWeekInfo(date);
  return `KW ${week} / ${isoYear}`;
}

export default function Home() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");

  const [authRole, setAuthRole] = useState<UserRole>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [linkedEmployeeId, setLinkedEmployeeId] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [weeklyEdits, setWeeklyEdits] = useState<Record<string, WeeklyEdit>>(
    {}
  );

  const [newName, setNewName] = useState("");
  const [newEmploymentType, setNewEmploymentType] =
    useState<EmploymentType>("Vollzeit");
  const [newVacation, setNewVacation] = useState("30");
  const [newWeeklyTarget, setNewWeeklyTarget] = useState("40");
  const [editingEmployeeId, setEditingEmployeeId] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [employmentFilter, setEmploymentFilter] =
    useState<EmploymentFilter>("Alle");
  const [weekStart, setWeekStart] = useState(getCurrentMondayIso());
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthPrefix());

  const [correctionEmployeeId, setCorrectionEmployeeId] = useState("");
  const [manualEntryDate, setManualEntryDate] = useState(getTodayIso());
  const [manualClockIn, setManualClockIn] = useState("10:00");
  const [manualClockOut, setManualClockOut] = useState("18:00");
  const [manualReason, setManualReason] = useState("Manuelle Korrektur");

  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 900);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function closeMobileMenu() {
    if (isMobile) setMobileMenuOpen(false);
  }

  function clearAuthState() {
    setLoggedIn(false);
    setAuthRole(null);
    setAuthEmail("");
    setLinkedEmployeeId(null);
  }

  function mapEmploymentType(value: string): EmploymentType {
    if (value === "Teilzeit") return "Teilzeit";
    if (value === "Minijob") return "Minijob";
    if (value === "Shop Manager") return "Shop Manager";
    if (value === "Praktikant") return "Praktikant";
    if (value === "admin") return "Shop Manager";
    return "Vollzeit";
  }

  function mapEmployeeRow(row: any): Employee {
    return {
      id: String(row.id),
      name: row.name ?? "",
      employmentType: mapEmploymentType(row.role ?? ""),
      vacationDaysTotal: Number(row.remaining_vacation_days ?? 0),
      weeklyTargetHours: Number(row.target_weekly_hours ?? 40),
    };
  }

  function mapShiftRow(row: any): Shift {
    const validDay = dayOrder.includes(row.day) ? row.day : "monday";

    const validStatus: ShiftStatus =
      row.status === "FREI" ||
      row.status === "URLAUB" ||
      row.status === "KRANK" ||
      row.status === "SCHULUNG" ||
      row.status === "FEIERTAG"
        ? row.status
        : "ARBEIT";

    return {
      id: row.id,
      employeeId: String(row.employee_id),
      weekStart: row.week_start ?? "",
      day: validDay,
      status: validStatus,
      start: row.start_time ?? "",
      end: row.end_time ?? "",
      location: row.location === "KA" ? "KA" : "PF",
      note: row.note ?? "",
    };
  }

  function mapTimeEntryRow(row: any): TimeEntry {
    return {
      id: Number(row.id),
      employeeId: String(row.employee_id),
      entryDate: row.entry_date ?? "",
      clockIn: row.clock_in ?? "",
      clockOut: row.clock_out ?? "",
      manualOverride: Boolean(row.manual_override),
      reason: row.reason ?? "",
    };
  }

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      console.error("Fehler beim Laden der Mitarbeiter:", error);
      return;
    }

    setEmployees((data ?? []).map(mapEmployeeRow));
  }

  async function loadShifts() {
    const { data, error } = await supabase
      .from("shifts")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      console.error("Fehler beim Laden der Schichten:", error);
      return;
    }

    setShifts((data ?? []).map(mapShiftRow));
  }

  async function loadTimeEntries() {
    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      console.error("Fehler beim Laden der Stempelzeiten:", error);
      return;
    }

    setTimeEntries((data ?? []).map(mapTimeEntryRow));
  }

  async function loadEverything() {
    await loadEmployees();
    await loadShifts();
    await loadTimeEntries();
  }

  async function loadAuthProfile(userId: string) {
    const { data, error } = await supabase
      .from("profiles")
      .select("app_role, employee_id")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Fehler beim Laden des Profils:", error);
      setAuthRole(null);
      setLinkedEmployeeId(null);
      return;
    }

    setAuthRole(data?.app_role === "admin" ? "admin" : "mitarbeiter");
    setLinkedEmployeeId(data?.employee_id ? String(data.employee_id) : null);
  }

  useEffect(() => {
    let active = true;

    const init = async () => {
      try {
        setLoading(true);

        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) throw error;
        if (!active) return;

        if (session?.user) {
          setLoggedIn(true);
          setAuthEmail(session.user.email ?? "");
          await loadAuthProfile(session.user.id);
          await loadEverything();
        } else {
          clearAuthState();
        }
      } catch (error) {
        console.error("Init-Fehler:", error);
        clearAuthState();
      } finally {
        if (active) setLoading(false);
      }
    };

    init();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (employees.length > 0 && !correctionEmployeeId) {
      setCorrectionEmployeeId(employees[0].id);
    }
  }, [employees, correctionEmployeeId]);

  useEffect(() => {
    const next: Record<string, WeeklyEdit> = {};

    for (const employee of employees) {
      for (const day of dayOrder) {
        const dateIso = getShiftDateIso(weekStart, day);

        const shift = shifts.find(
          (item) =>
            item.employeeId === employee.id &&
            item.weekStart === weekStart &&
            item.day === day
        );

        next[getCellKey(employee.id, day)] = shift
          ? {
              status: shift.status,
              start: shift.start || "10:00",
              end: shift.end || "18:00",
              location: shift.location || "PF",
              note: shift.note || "",
            }
          : getDefaultEditForDate(dateIso, day);
      }
    }

    setWeeklyEdits(next);
  }, [employees, shifts, weekStart]);

  function getCellKey(employeeId: string, day: DayKey) {
    return `${employeeId}_${day}`;
  }

  function updateCell(
    employeeId: string,
    day: DayKey,
    patch: Partial<WeeklyEdit>
  ) {
    const key = getCellKey(employeeId, day);

    setWeeklyEdits((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? emptyEdit()),
        ...patch,
      },
    }));
  }

  function isAushilfe(employeeId: string) {
    const employee = employees.find((e) => e.id === employeeId);
    return employee?.employmentType === "Minijob";
  }

  async function handleLogin() {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      alert("Bitte E-Mail und Passwort eingeben.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });

      if (error) {
        alert("Login fehlgeschlagen: " + error.message);
        return;
      }

      if (data.session?.user) {
        setLoggedIn(true);
        setAuthEmail(data.session.user.email ?? "");
        await loadAuthProfile(data.session.user.id);
        await loadEverything();
      }

      setLoginPassword("");
      setActiveTab("dashboard");
    } catch (error) {
      console.error("Login-Fehler:", error);
      alert("Beim Login ist ein Fehler aufgetreten.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    clearAuthState();
    setActiveTab("dashboard");
    setLoading(false);
  }

  async function addEmployee() {
    if (!newName.trim()) {
      alert("Bitte zuerst einen Namen eingeben.");
      return;
    }

    if (authRole !== "admin") {
      alert("Nur Admin darf Mitarbeiter verwalten.");
      return;
    }

    if (editingEmployeeId) {
      const { error } = await supabase
        .from("employees")
        .update({
          name: newName.trim(),
          role: newEmploymentType,
          remaining_vacation_days: Number(newVacation) || 0,
          target_weekly_hours: Number(newWeeklyTarget) || 0,
        })
        .eq("id", Number(editingEmployeeId));

      if (error) {
        alert("Fehler beim Aktualisieren des Mitarbeiters: " + error.message);
        return;
      }

      resetEmployeeForm();
      await loadEmployees();
      alert("Mitarbeiter aktualisiert.");
      return;
    }

    const { error } = await supabase.from("employees").insert([
      {
        name: newName.trim(),
        role: newEmploymentType,
        remaining_vacation_days: Number(newVacation) || 0,
        target_weekly_hours: Number(newWeeklyTarget) || 0,
      },
    ]);

    if (error) {
      alert("Fehler beim Speichern des Mitarbeiters: " + error.message);
      return;
    }

    resetEmployeeForm();
    await loadEmployees();
    alert("Mitarbeiter gespeichert.");
  }

  function startEditEmployee(employee: Employee) {
    setEditingEmployeeId(employee.id);
    setNewName(employee.name);
    setNewEmploymentType(employee.employmentType);
    setNewVacation(String(employee.vacationDaysTotal));
    setNewWeeklyTarget(String(employee.weeklyTargetHours));
    setActiveTab("mitarbeiter");
  }

  function resetEmployeeForm() {
    setEditingEmployeeId("");
    setNewName("");
    setNewEmploymentType("Vollzeit");
    setNewVacation("30");
    setNewWeeklyTarget("40");
  }

  async function deleteEmployee(employeeId: string, employeeName: string) {
    if (authRole !== "admin") {
      alert("Nur Admin darf Mitarbeiter löschen.");
      return;
    }

    if (employeeName.toLowerCase() === "admin") {
      alert("Das Admin-Konto kann hier nicht gelöscht werden.");
      return;
    }

    const confirmed = window.confirm(
      `Mitarbeiter "${employeeName}" wirklich löschen?`
    );

    if (!confirmed) return;

    const { error: deleteShiftsError } = await supabase
      .from("shifts")
      .delete()
      .eq("employee_id", Number(employeeId));

    if (deleteShiftsError) {
      alert("Fehler beim Löschen der Schichten: " + deleteShiftsError.message);
      return;
    }

    const { error: deleteEntriesError } = await supabase
      .from("time_entries")
      .delete()
      .eq("employee_id", Number(employeeId));

    if (deleteEntriesError) {
      alert(
        "Fehler beim Löschen der Stempelzeiten: " + deleteEntriesError.message
      );
      return;
    }

    const { error: deleteEmployeeError } = await supabase
      .from("employees")
      .delete()
      .eq("id", Number(employeeId));

    if (deleteEmployeeError) {
      alert(
        "Fehler beim Löschen des Mitarbeiters: " + deleteEmployeeError.message
      );
      return;
    }

    if (editingEmployeeId === employeeId) {
      resetEmployeeForm();
    }

    await loadEmployees();
    await loadShifts();
    await loadTimeEntries();
    alert("Mitarbeiter gelöscht.");
  }

  async function saveEmployeeWeek(employeeId: string, silent = false) {
    if (!weekStart) {
      alert("Bitte zuerst die Woche auswählen.");
      return false;
    }

    if (authRole !== "admin") {
      alert("Nur Admin darf den Wochenplan speichern.");
      return false;
    }

    for (const day of dayOrder) {
      const key = getCellKey(employeeId, day);
      const edit = weeklyEdits[key] ?? emptyEdit();

      const { error: deleteError } = await supabase
        .from("shifts")
        .delete()
        .eq("employee_id", Number(employeeId))
        .eq("week_start", weekStart)
        .eq("day", day);

      if (deleteError) {
        alert("Fehler beim Löschen alter Schichten: " + deleteError.message);
        return false;
      }

      if (edit.status === "LEER") continue;

      if (edit.status === "ARBEIT" && (!edit.start || !edit.end)) {
        alert("Bitte Zeiten vollständig eintragen.");
        return false;
      }

      const { error: insertError } = await supabase.from("shifts").insert([
        {
          employee_id: Number(employeeId),
          week_start: weekStart,
          day,
          status: edit.status,
          start_time: edit.status === "ARBEIT" ? edit.start : "",
          end_time: edit.status === "ARBEIT" ? edit.end : "",
          location: edit.location,
          note: edit.note,
        },
      ]);

      if (insertError) {
        alert("Fehler beim Speichern der Woche: " + insertError.message);
        return false;
      }
    }

    if (!silent) {
      await loadShifts();
      alert("Woche gespeichert.");
    }

    return true;
  }

  async function saveAllVisibleWeeks() {
    if (authRole !== "admin") {
      alert("Nur Admin darf mehrere Zeilen speichern.");
      return;
    }

    if (filteredEmployees.length === 0) {
      alert("Keine sichtbaren Mitarbeiter vorhanden.");
      return;
    }

    for (const employee of filteredEmployees) {
      const ok = await saveEmployeeWeek(employee.id, true);
      if (!ok) return;
    }

    await loadShifts();
    alert("Alle sichtbaren Zeilen gespeichert.");
  }

  async function copyPreviousWeekToCurrent() {
    if (authRole !== "admin") {
      alert("Nur Admin darf Wochen kopieren.");
      return;
    }

    if (!weekStart) {
      alert("Bitte zuerst die Woche auswählen.");
      return;
    }

    const previousWeek = shiftIsoDate(weekStart, -7);
    const sourceShifts = shifts.filter((shift) => shift.weekStart === previousWeek);

    if (sourceShifts.length === 0) {
      alert("In der Vorwoche wurden keine Schichten gefunden.");
      return;
    }

    const { error: deleteError } = await supabase
      .from("shifts")
      .delete()
      .eq("week_start", weekStart);

    if (deleteError) {
      alert(
        "Fehler beim Leeren der aktuellen Woche: " + deleteError.message
      );
      return;
    }

    const rows = sourceShifts.map((shift) => ({
      employee_id: Number(shift.employeeId),
      week_start: weekStart,
      day: shift.day,
      status: shift.status,
      start_time: shift.start,
      end_time: shift.end,
      location: shift.location,
      note: shift.note ?? "",
    }));

    const { error: insertError } = await supabase.from("shifts").insert(rows);

    if (insertError) {
      alert("Fehler beim Kopieren der Vorwoche: " + insertError.message);
      return;
    }

    await loadShifts();
    alert("Vorwoche in aktuelle Woche kopiert.");
  }

  function toMinutes(value: string) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function hasOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
    return aStart < bEnd && bStart < aEnd;
  }

  function getShiftDateIso(weekStartIso: string, day: DayKey) {
    const dayIndexMap: Record<DayKey, number> = {
      monday: 0,
      tuesday: 1,
      wednesday: 2,
      thursday: 3,
      friday: 4,
      saturday: 5,
      sunday: 6,
    };

    return shiftIsoDate(weekStartIso, dayIndexMap[day]);
  }

  const selectedVacationYear = useMemo(() => {
    const year = Number(weekStart.slice(0, 4));
    return Number.isNaN(year) ? new Date().getFullYear() : year;
  }, [weekStart]);

  const vacationSummaryByEmployee = useMemo(() => {
    const result: Record<string, VacationSummary> = {};

    for (const employee of employees) {
      const used = shifts.filter((shift) => {
        if (shift.employeeId !== employee.id) return false;
        if (shift.status !== "URLAUB") return false;
        const dateIso = getShiftDateIso(shift.weekStart, shift.day);
        return dateIso.startsWith(`${selectedVacationYear}-`);
      }).length;

      const total = employee.vacationDaysTotal || 0;
      const remaining = Math.max(0, total - used);

      result[employee.id] = {
        total,
        used,
        remaining,
      };
    }

    return result;
  }, [employees, shifts, selectedVacationYear]);

  const previewShifts = useMemo(() => {
    const list: Shift[] = [];

    for (const employee of employees) {
      for (const day of dayOrder) {
        const edit = weeklyEdits[getCellKey(employee.id, day)];
        if (!edit || edit.status === "LEER") continue;

        list.push({
          employeeId: employee.id,
          weekStart,
          day,
          status: edit.status,
          start: edit.status === "ARBEIT" ? edit.start : "",
          end: edit.status === "ARBEIT" ? edit.end : "",
          location: edit.location,
          note: edit.note,
        });
      }
    }

    return list;
  }, [employees, weeklyEdits, weekStart]);

  function isAloneAtLocationPreview(currentShift: Shift) {
    if (currentShift.status !== "ARBEIT") return false;

    const currentStart = toMinutes(currentShift.start);
    const currentEnd = toMinutes(currentShift.end);

    const overlappingColleague = previewShifts.find((other) => {
      if (other.employeeId === currentShift.employeeId) return false;
      if (other.weekStart !== currentShift.weekStart) return false;
      if (other.day !== currentShift.day) return false;
      if (other.status !== "ARBEIT") return false;
      if (other.location !== currentShift.location) return false;
      if (!other.start || !other.end) return false;

      const otherStart = toMinutes(other.start);
      const otherEnd = toMinutes(other.end);

      return hasOverlap(currentStart, currentEnd, otherStart, otherEnd);
    });

    return !overlappingColleague;
  }

  function isAloneAtLocationStored(currentShift: Shift) {
    if (currentShift.status !== "ARBEIT") return false;

    const currentStart = toMinutes(currentShift.start);
    const currentEnd = toMinutes(currentShift.end);

    const overlappingColleague = shifts.find((other) => {
      if (other.employeeId === currentShift.employeeId) return false;
      if (other.weekStart !== currentShift.weekStart) return false;
      if (other.day !== currentShift.day) return false;
      if (other.status !== "ARBEIT") return false;
      if (other.location !== currentShift.location) return false;
      if (!other.start || !other.end) return false;

      const otherStart = toMinutes(other.start);
      const otherEnd = toMinutes(other.end);

      return hasOverlap(currentStart, currentEnd, otherStart, otherEnd);
    });

    return !overlappingColleague;
  }

  function calculatePreviewShiftMinutes(shift?: Shift) {
    if (!shift) return 0;

    if (shift.status === "FEIERTAG") {
      return isAushilfe(shift.employeeId) ? 0 : FEIERTAG_MINUTES;
    }

    if (shift.status === "URLAUB") return 0;
    if (shift.status !== "ARBEIT") return 0;
    if (!shift.start || !shift.end) return 0;

    const start = toMinutes(shift.start);
    const end = toMinutes(shift.end);
    const rawMinutes = Math.max(0, end - start);

    let pause = 0;
    if (rawMinutes > 360) {
      const alone = isAloneAtLocationPreview(shift);
      pause = alone ? 0 : 30;
    }

    return rawMinutes - pause;
  }

  function calculateStoredShiftMinutes(shift?: Shift) {
    if (!shift) return 0;

    if (shift.status === "FEIERTAG") {
      return isAushilfe(shift.employeeId) ? 0 : FEIERTAG_MINUTES;
    }

    if (shift.status === "URLAUB") return 0;
    if (shift.status !== "ARBEIT") return 0;
    if (!shift.start || !shift.end) return 0;

    const start = toMinutes(shift.start);
    const end = toMinutes(shift.end);
    const rawMinutes = Math.max(0, end - start);

    let pause = 0;
    if (rawMinutes > 360) {
      const alone = isAloneAtLocationStored(shift);
      pause = alone ? 0 : 30;
    }

    return rawMinutes - pause;
  }

  function calculateTimeEntryMinutes(entry: TimeEntry) {
    if (!entry.clockIn) return 0;
    const start = toMinutes(entry.clockIn);
    const end = entry.clockOut
      ? toMinutes(entry.clockOut)
      : toMinutes(getCurrentTimeHHMM());

    return Math.max(0, end - start);
  }

  function formatHours(minutes: number) {
    const rounded = Math.round(minutes);
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  function formatDifference(minutes: number) {
    const prefix = minutes > 0 ? "+" : minutes < 0 ? "-" : "";
    return `${prefix}${formatHours(Math.abs(minutes))}`;
  }

  function getDateForDay(day: DayKey) {
    if (!weekStart) return "";
    const [year, month, dayOfMonth] = weekStart.split("-").map(Number);
    const dayIndexMap: Record<DayKey, number> = {
      monday: 0,
      tuesday: 1,
      wednesday: 2,
      thursday: 3,
      friday: 4,
      saturday: 5,
      sunday: 6,
    };

    const base = new Date(year, month - 1, dayOfMonth);
    base.setDate(base.getDate() + dayIndexMap[day]);

    const dd = String(base.getDate()).padStart(2, "0");
    const mm = String(base.getMonth() + 1).padStart(2, "0");
    const yyyy = base.getFullYear();

    return `${dd}.${mm}.${yyyy}`;
  }

  const weekInputValue = useMemo(
    () => getWeekInputValueFromMondayIso(weekStart),
    [weekStart]
  );

  const calendarWeekLabel = useMemo(
    () => getCalendarWeekLabelFromMondayIso(weekStart),
    [weekStart]
  );

  const currentEmployee = useMemo(() => {
    if (linkedEmployeeId) {
      return employees.find((employee) => employee.id === linkedEmployeeId);
    }

    if (authRole === "admin") {
      return (
        employees.find((employee) => employee.name.toLowerCase() === "admin") ||
        undefined
      );
    }

    return undefined;
  }, [employees, authRole, linkedEmployeeId]);

  const employeeWeekMinutes = useMemo(() => {
    const result: Record<string, number> = {};

    for (const employee of employees) {
      const total = previewShifts
        .filter((shift) => shift.employeeId === employee.id)
        .reduce((sum, shift) => sum + calculatePreviewShiftMinutes(shift), 0);

      result[employee.id] = total;
    }

    return result;
  }, [employees, previewShifts]);

  const weeklyTargetMinutesByEmployee = useMemo(() => {
    const result: Record<string, number> = {};

    for (const employee of employees) {
      result[employee.id] = Math.round((employee.weeklyTargetHours || 0) * 60);
    }

    return result;
  }, [employees]);

  const weeklyDifferenceByEmployee = useMemo(() => {
    const result: Record<string, number> = {};

    for (const employee of employees) {
      const planned = employeeWeekMinutes[employee.id] || 0;
      const target = weeklyTargetMinutesByEmployee[employee.id] || 0;
      result[employee.id] = planned - target;
    }

    return result;
  }, [employees, employeeWeekMinutes, weeklyTargetMinutesByEmployee]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((employee) => {
      const matchesSearch = employee.name
        .toLowerCase()
        .includes(searchTerm.toLowerCase());

      const matchesEmployment =
        employmentFilter === "Alle" ||
        employee.employmentType === employmentFilter;

      return matchesSearch && matchesEmployment;
    });
  }, [employees, searchTerm, employmentFilter]);

  const monthlyOverview = useMemo(() => {
    return filteredEmployees.map((employee) => {
      const plannedMinutes = shifts
        .filter(
          (shift) =>
            shift.employeeId === employee.id &&
            getShiftDateIso(shift.weekStart, shift.day).startsWith(selectedMonth)
        )
        .reduce((sum, shift) => sum + calculateStoredShiftMinutes(shift), 0);

      const stampedMinutes = timeEntries
        .filter(
          (entry) =>
            entry.employeeId === employee.id &&
            entry.entryDate.startsWith(selectedMonth)
        )
        .reduce((sum, entry) => sum + calculateTimeEntryMinutes(entry), 0);

      return {
        employee,
        plannedMinutes,
        stampedMinutes,
        difference: stampedMinutes - plannedMinutes,
      };
    });
  }, [filteredEmployees, shifts, timeEntries, selectedMonth]);

  const monthlyTotals = useMemo(() => {
    return monthlyOverview.reduce(
      (acc, item) => {
        acc.planned += item.plannedMinutes;
        acc.stamped += item.stampedMinutes;
        acc.diff += item.difference;
        return acc;
      },
      { planned: 0, stamped: 0, diff: 0 }
    );
  }, [monthlyOverview]);

  const todayIso = getTodayIso();

  const openTimeEntry = useMemo(() => {
    return timeEntries.find(
      (entry) =>
        entry.employeeId === currentEmployee?.id &&
        entry.entryDate === todayIso &&
        !entry.clockOut
    );
  }, [timeEntries, currentEmployee?.id, todayIso]);

  const clockedIn = Boolean(openTimeEntry);

  const todayStampedMinutes = useMemo(() => {
    return timeEntries
      .filter(
        (entry) =>
          entry.employeeId === currentEmployee?.id &&
          entry.entryDate === todayIso
      )
      .reduce((sum, entry) => sum + calculateTimeEntryMinutes(entry), 0);
  }, [timeEntries, currentEmployee?.id, todayIso]);

  const monthStampedMinutes = useMemo(() => {
    const monthPrefix = getCurrentMonthPrefix();

    return timeEntries
      .filter(
        (entry) =>
          entry.employeeId === currentEmployee?.id &&
          entry.entryDate.startsWith(monthPrefix)
      )
      .reduce((sum, entry) => sum + calculateTimeEntryMinutes(entry), 0);
  }, [timeEntries, currentEmployee?.id]);

  function getOpenTimeEntryForEmployee(employeeId: string) {
    return timeEntries.find(
      (entry) =>
        entry.employeeId === employeeId &&
        entry.entryDate === todayIso &&
        !entry.clockOut
    );
  }

  function getTodayEntriesForEmployee(employeeId: string) {
    return timeEntries.filter(
      (entry) => entry.employeeId === employeeId && entry.entryDate === todayIso
    );
  }

  function getTodayFirstClockIn(employeeId: string) {
    const entries = getTodayEntriesForEmployee(employeeId).filter(
      (entry) => entry.clockIn
    );
    if (entries.length === 0) return "-";
    const sorted = [...entries].sort((a, b) => a.clockIn.localeCompare(b.clockIn));
    return sorted[0].clockIn;
  }

  function getTodayLastClockOut(employeeId: string) {
    const entries = getTodayEntriesForEmployee(employeeId).filter(
      (entry) => entry.clockOut
    );
    if (entries.length === 0) return "-";
    const sorted = [...entries].sort((a, b) =>
      (a.clockOut || "").localeCompare(b.clockOut || "")
    );
    return sorted[sorted.length - 1].clockOut || "-";
  }

  function getTodayMinutesForEmployee(employeeId: string) {
    return getTodayEntriesForEmployee(employeeId).reduce(
      (sum, entry) => sum + calculateTimeEntryMinutes(entry),
      0
    );
  }

  const liveStampOverview = useMemo(() => {
    return employees.map((employee) => {
      const openEntry = getOpenTimeEntryForEmployee(employee.id);
      const isActive = Boolean(openEntry);

      return {
        employee,
        isActive,
        openEntry,
        firstClockIn: getTodayFirstClockIn(employee.id),
        lastClockOut: getTodayLastClockOut(employee.id),
        todayMinutes: getTodayMinutesForEmployee(employee.id),
      };
    });
  }, [employees, timeEntries, todayIso]);

  const activeStampedCount = useMemo(
    () => liveStampOverview.filter((item) => item.isActive).length,
    [liveStampOverview]
  );

  const inactiveStampedCount = useMemo(
    () => liveStampOverview.filter((item) => !item.isActive).length,
    [liveStampOverview]
  );

  async function handleClockIn() {
    if (!currentEmployee?.id) {
      alert("Dein Login ist noch keinem Mitarbeiter zugeordnet.");
      return;
    }

    if (openTimeEntry) {
      alert("Du bist bereits eingestempelt.");
      return;
    }

    const { error } = await supabase.from("time_entries").insert([
      {
        employee_id: Number(currentEmployee.id),
        entry_date: todayIso,
        clock_in: getCurrentTimeHHMM(),
        clock_out: "",
        manual_override: false,
        reason: "",
      },
    ]);

    if (error) {
      alert("Fehler beim Einstempeln: " + error.message);
      return;
    }

    await loadTimeEntries();
    alert("Eingestempelt.");
  }

  async function handleClockOut() {
    if (!currentEmployee?.id) {
      alert("Dein Login ist noch keinem Mitarbeiter zugeordnet.");
      return;
    }

    if (!openTimeEntry) {
      alert("Du bist nicht eingestempelt.");
      return;
    }

    const { error } = await supabase
      .from("time_entries")
      .update({
        clock_out: getCurrentTimeHHMM(),
      })
      .eq("id", openTimeEntry.id);

    if (error) {
      alert("Fehler beim Ausstempeln: " + error.message);
      return;
    }

    await loadTimeEntries();
    alert("Ausgestempelt.");
  }

  async function handleAdminClockIn(employeeId: string, employeeName: string) {
    if (authRole !== "admin") {
      alert("Nur Admin darf andere Mitarbeiter einstempeln.");
      return;
    }

    const existingOpen = getOpenTimeEntryForEmployee(employeeId);
    if (existingOpen) {
      alert(`${employeeName} ist bereits eingestempelt.`);
      return;
    }

    const { error } = await supabase.from("time_entries").insert([
      {
        employee_id: Number(employeeId),
        entry_date: todayIso,
        clock_in: getCurrentTimeHHMM(),
        clock_out: "",
        manual_override: true,
        reason: "Admin Einstempeln",
      },
    ]);

    if (error) {
      alert("Fehler beim Einstempeln: " + error.message);
      return;
    }

    await loadTimeEntries();
    alert(`${employeeName} wurde eingestempelt.`);
  }

  async function handleAdminClockOut(employeeId: string, employeeName: string) {
    if (authRole !== "admin") {
      alert("Nur Admin darf andere Mitarbeiter ausstempeln.");
      return;
    }

    const existingOpen = getOpenTimeEntryForEmployee(employeeId);
    if (!existingOpen) {
      alert(`${employeeName} ist nicht eingestempelt.`);
      return;
    }

    const { error } = await supabase
      .from("time_entries")
      .update({
        clock_out: getCurrentTimeHHMM(),
        manual_override: true,
        reason: existingOpen.reason
          ? `${existingOpen.reason} / Admin Ausstempeln`
          : "Admin Ausstempeln",
      })
      .eq("id", existingOpen.id);

    if (error) {
      alert("Fehler beim Ausstempeln: " + error.message);
      return;
    }

    await loadTimeEntries();
    alert(`${employeeName} wurde ausgestempelt.`);
  }

  function updateTimeEntryLocal(id: number, patch: Partial<TimeEntry>) {
    setTimeEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    );
  }

  async function saveTimeEntry(entry: TimeEntry) {
    if (authRole !== "admin") {
      alert("Nur Admin darf Stempelzeiten korrigieren.");
      return;
    }

    const { error } = await supabase
      .from("time_entries")
      .update({
        entry_date: entry.entryDate,
        clock_in: entry.clockIn,
        clock_out: entry.clockOut,
        manual_override: entry.manualOverride,
        reason: entry.reason,
      })
      .eq("id", entry.id);

    if (error) {
      alert("Fehler beim Speichern der Korrektur: " + error.message);
      return;
    }

    await loadTimeEntries();
    alert("Stempelzeit aktualisiert.");
  }

  async function deleteTimeEntry(entryId: number) {
    if (authRole !== "admin") {
      alert("Nur Admin darf Stempelzeiten löschen.");
      return;
    }

    const confirmed = window.confirm("Diese Stempelzeit wirklich löschen?");
    if (!confirmed) return;

    const { error } = await supabase
      .from("time_entries")
      .delete()
      .eq("id", entryId);

    if (error) {
      alert("Fehler beim Löschen der Stempelzeit: " + error.message);
      return;
    }

    await loadTimeEntries();
    alert("Stempelzeit gelöscht.");
  }

  async function addManualTimeEntry() {
    if (authRole !== "admin") {
      alert("Nur Admin darf manuelle Buchungen anlegen.");
      return;
    }

    if (!correctionEmployeeId) {
      alert("Bitte zuerst einen Mitarbeiter auswählen.");
      return;
    }

    if (!manualEntryDate || !manualClockIn) {
      alert("Bitte Datum und Kommen eintragen.");
      return;
    }

    const { error } = await supabase.from("time_entries").insert([
      {
        employee_id: Number(correctionEmployeeId),
        entry_date: manualEntryDate,
        clock_in: manualClockIn,
        clock_out: manualClockOut,
        manual_override: true,
        reason: manualReason,
      },
    ]);

    if (error) {
      alert("Fehler beim Speichern der manuellen Buchung: " + error.message);
      return;
    }

    await loadTimeEntries();
    alert("Manuelle Buchung gespeichert.");
  }

  const displayedTimeEntries = useMemo(() => {
    if (!correctionEmployeeId) return [];
    return timeEntries.filter((entry) => entry.employeeId === correctionEmployeeId);
  }, [timeEntries, correctionEmployeeId]);

  function getCellExportText(employeeId: string, day: DayKey) {
    const edit = weeklyEdits[getCellKey(employeeId, day)] ?? emptyEdit();

    if (edit.status === "LEER") return "";
    if (edit.status !== "ARBEIT") {
      return edit.note ? `${edit.status} - ${edit.note}` : edit.status;
    }

    const base = `(${edit.location}) ${edit.start}-${edit.end}`;
    return edit.note ? `${base} - ${edit.note}` : base;
  }

  function exportWeekCsv() {
    const rows: string[] = [];

    rows.push(
      [
        "Name",
        "Anstellungsart",
        "Montag",
        "Dienstag",
        "Mittwoch",
        "Donnerstag",
        "Freitag",
        "Samstag",
        "Sonntag",
        "Geplant",
        "Soll",
        "Differenz",
      ]
        .map(csvEscape)
        .join(";")
    );

    for (const employee of filteredEmployees) {
      rows.push(
        [
          employee.name,
          employee.employmentType,
          getCellExportText(employee.id, "monday"),
          getCellExportText(employee.id, "tuesday"),
          getCellExportText(employee.id, "wednesday"),
          getCellExportText(employee.id, "thursday"),
          getCellExportText(employee.id, "friday"),
          getCellExportText(employee.id, "saturday"),
          getCellExportText(employee.id, "sunday"),
          formatHours(employeeWeekMinutes[employee.id] || 0),
          formatHours(weeklyTargetMinutesByEmployee[employee.id] || 0),
          formatDifference(weeklyDifferenceByEmployee[employee.id] || 0),
        ]
          .map(csvEscape)
          .join(";")
      );
    }

    downloadTextFile(
      `wochenplan_${calendarWeekLabel.replaceAll(" ", "_")}.csv`,
      "\uFEFF" + rows.join("\n"),
      "text/csv;charset=utf-8;"
    );
  }

  function exportTimeEntriesCsv() {
    const selectedEmployee = employees.find(
      (employee) => employee.id === correctionEmployeeId
    );

    const rows: string[] = [];
    rows.push(
      [
        "Name",
        "Datum",
        "Kommen",
        "Gehen",
        "Minuten",
        "Manuell",
        "Grund",
      ]
        .map(csvEscape)
        .join(";")
    );

    for (const entry of displayedTimeEntries) {
      rows.push(
        [
          selectedEmployee?.name ?? "",
          entry.entryDate,
          entry.clockIn,
          entry.clockOut,
          calculateTimeEntryMinutes(entry),
          entry.manualOverride ? "Ja" : "Nein",
          entry.reason,
        ]
          .map(csvEscape)
          .join(";")
      );
    }

    downloadTextFile(
      `stempelzeiten_${selectedEmployee?.name ?? "mitarbeiter"}.csv`,
      "\uFEFF" + rows.join("\n"),
      "text/csv;charset=utf-8;"
    );
  }

  function exportMonthCsv() {
    const rows: string[] = [];
    rows.push(
      ["Name", "Anstellungsart", "Geplant", "Gestempelt", "Differenz"]
        .map(csvEscape)
        .join(";")
    );

    for (const item of monthlyOverview) {
      rows.push(
        [
          item.employee.name,
          item.employee.employmentType,
          formatHours(item.plannedMinutes),
          formatHours(item.stampedMinutes),
          formatDifference(item.difference),
        ]
          .map(csvEscape)
          .join(";")
      );
    }

    rows.push(
      [
        "GESAMT",
        "",
        formatHours(monthlyTotals.planned),
        formatHours(monthlyTotals.stamped),
        formatDifference(monthlyTotals.diff),
      ]
        .map(csvEscape)
        .join(";")
    );

    downloadTextFile(
      `monatsuebersicht_${selectedMonth}.csv`,
      "\uFEFF" + rows.join("\n"),
      "text/csv;charset=utf-8;"
    );
  }

  function printWeekPlan() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const headerDays = dayOrder
      .map((day) => {
        const dateIso = getShiftDateIso(weekStart, day);
        const special = getSpecialDayLabel(dateIso, day);

        return `<th>
          ${dayLabels[day]}<br>
          <span style="font-weight:normal;font-size:12px;">${getDateForDay(day)}</span>
          ${
            special
              ? `<br><span style="font-weight:bold;font-size:11px;color:#b91c1c;">${special}</span>`
              : ""
          }
        </th>`;
      })
      .join("");

    const bodyRows = filteredEmployees
      .map((employee) => {
        const dayCells = dayOrder
          .map((day) => `<td>${getCellExportText(employee.id, day) || "-"}</td>`)
          .join("");

        return `
          <tr>
            <td>${employee.name}</td>
            ${dayCells}
            <td>${formatHours(employeeWeekMinutes[employee.id] || 0)}</td>
            <td>${formatHours(weeklyTargetMinutesByEmployee[employee.id] || 0)}</td>
            <td>${formatDifference(weeklyDifferenceByEmployee[employee.id] || 0)}</td>
          </tr>
        `;
      })
      .join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Wochenplan ${calendarWeekLabel}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { margin-bottom: 4px; }
            p { color: #555; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #999; padding: 8px; vertical-align: top; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h1>Wochenplan</h1>
          <p>${calendarWeekLabel} · Woche ab ${weekStart}</p>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                ${headerDays}
                <th>Geplant</th>
                <th>Soll</th>
                <th>Differenz</th>
              </tr>
            </thead>
            <tbody>
              ${bodyRows || `<tr><td colspan="12">Keine Daten</td></tr>`}
            </tbody>
          </table>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  function renderDashboard() {
    const currentVacationSummary = currentEmployee
      ? vacationSummaryByEmployee[currentEmployee.id]
      : undefined;

    return (
      <>
        {!currentEmployee ? (
          <div style={warningBannerStyle}>
            Dein Login ist noch keinem Mitarbeiter zugeordnet. Alles ansehen geht
            trotzdem, aber Ein- und Ausstempeln geht erst nach der Verknüpfung.
          </div>
        ) : null}

        <div style={isMobile ? modernHeroMobileStyle : modernHeroStyle}>
          <div>
            <div style={modernHeroEyebrowStyle}>Arbeitszeit Tool</div>
            <h2 style={isMobile ? modernHeroTitleMobileStyle : modernHeroTitleStyle}>Dashboard</h2>
            <p style={modernHeroTextStyle}>
              Übersicht über Schichten, Resturlaub, Stempelstatus und aktuelle
              Arbeitszeiten.
            </p>
          </div>

          <div style={heroButtonWrapStyle}>
            <button
              onClick={() => setActiveTab("wochenplan")}
              style={primaryActionButtonStyle}
            >
              Wochenplan öffnen
            </button>
            <button
              onClick={() => setActiveTab("stempelzeiten")}
              style={secondaryActionButtonStyle}
            >
              Stempelübersicht
            </button>
          </div>
        </div>

        <div style={dashboardGridStyle}>
          <InfoCard title="Status">
            {clockedIn
              ? `Eingestempelt seit ${openTimeEntry?.clockIn ?? ""}`
              : "Nicht eingestempelt"}
          </InfoCard>
          <InfoCard title="Geplante Stunden diese Woche">
            {formatHours(employeeWeekMinutes[currentEmployee?.id || ""] || 0)}
          </InfoCard>
          <InfoCard title="Sollstunden diese Woche">
            {formatHours(
              weeklyTargetMinutesByEmployee[currentEmployee?.id || ""] || 0
            )}
          </InfoCard>
          <InfoCard title="Überstunden / Minusstunden">
            {formatDifference(
              weeklyDifferenceByEmployee[currentEmployee?.id || ""] || 0
            )}
          </InfoCard>
          <InfoCard title="Gestempelte Monatsstunden">
            {formatHours(monthStampedMinutes)}
          </InfoCard>
          <InfoCard title={`Resturlaub ${selectedVacationYear}`}>
            {currentVacationSummary
              ? `${currentVacationSummary.remaining} Tage`
              : "0 Tage"}
          </InfoCard>
        </div>

        <div style={quickActionsGridStyle}>
          <QuickActionModern
            title="Wochenplan"
            text="Schichten ansehen oder bearbeiten."
            onClick={() => setActiveTab("wochenplan")}
          />
          <QuickActionModern
            title="Stempelzeiten"
            text="Wer ist drin, wer ist draußen."
            onClick={() => setActiveTab("stempelzeiten")}
          />
          <QuickActionModern
            title="Mitarbeiter"
            text="Mitarbeiterdaten verwalten."
            onClick={() => setActiveTab("mitarbeiter")}
          />
          <QuickActionModern
            title="Monatsübersicht"
            text="Geplante und gestempelte Stunden vergleichen."
            onClick={() => setActiveTab("monatsuebersicht")}
          />
        </div>
      </>
    );
  }

  function renderWochenplan() {
    const showAdminActions = authRole === "admin";

    function getOwnRowBackground(isOwnRow: boolean) {
      return isOwnRow ? "#eef5ff" : "#ffffff";
    }

    function getStatusPalette(status: EditableShiftStatus) {
      switch (status) {
        case "ARBEIT":
          return {
            bg: "#eff6ff",
            border: "#bfdbfe",
            badgeBg: "#2563eb",
            badgeColor: "#ffffff",
          };
        case "FREI":
          return {
            bg: "#f3f4f6",
            border: "#e5e7eb",
            badgeBg: "#6b7280",
            badgeColor: "#ffffff",
          };
        case "URLAUB":
          return {
            bg: "#ecfdf3",
            border: "#bbf7d0",
            badgeBg: "#16a34a",
            badgeColor: "#ffffff",
          };
        case "KRANK":
          return {
            bg: "#fff7ed",
            border: "#fdba74",
            badgeBg: "#ea580c",
            badgeColor: "#ffffff",
          };
        case "SCHULUNG":
          return {
            bg: "#fefce8",
            border: "#fde68a",
            badgeBg: "#ca8a04",
            badgeColor: "#ffffff",
          };
        case "FEIERTAG":
          return {
            bg: "#fef2f2",
            border: "#fecaca",
            badgeBg: "#dc2626",
            badgeColor: "#ffffff",
          };
        default:
          return {
            bg: "#ffffff",
            border: "#e5e7eb",
            badgeBg: "#9ca3af",
            badgeColor: "#ffffff",
          };
      }
    }

    function renderPlanCard(
      employee: Employee,
      day: DayKey,
      isOwnRow: boolean
    ) {
      const key = getCellKey(employee.id, day);
      const edit = weeklyEdits[key] ?? emptyEdit();
      const palette = getStatusPalette(edit.status);
      const dateIso = getShiftDateIso(weekStart, day);
      const specialLabel = getSpecialDayLabel(dateIso, day);

      const cardStyle: CSSProperties = {
        borderRadius: "18px",
        border: `1px solid ${palette.border}`,
        background: edit.status === "LEER" ? "#ffffff" : palette.bg,
        padding: "12px",
        minHeight: isMobile ? "auto" : "188px",
        boxShadow: isOwnRow
          ? "0 0 0 2px rgba(37,99,235,0.14)"
          : "0 6px 18px rgba(15,23,42,0.05)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      };

      if (authRole !== "admin") {
        return (
          <div style={cardStyle}>
            <div>
              <div style={cardTopRowStyle}>
                <div style={dayCardTitleStyle}>{dayLabels[day]}</div>
                <div style={dayCardDateStyle}>{getDateForDay(day)}</div>
              </div>

              <div
                style={{
                  ...statusPillStyle,
                  background: palette.badgeBg,
                  color: palette.badgeColor,
                }}
              >
                {edit.status === "LEER" ? "LEER" : edit.status}
              </div>

              {specialLabel ? (
                <div style={specialLabelStyle}>{specialLabel}</div>
              ) : null}

              {edit.status === "ARBEIT" ? (
                <>
                  <div style={timeBigStyle}>
                    {edit.start} - {edit.end}
                  </div>
                  <div style={subInfoStyle}>Standort: {edit.location}</div>
                </>
              ) : null}

              {edit.note ? <div style={noteTextStyle}>{edit.note}</div> : null}

              {edit.status === "LEER" ? (
                <div style={notePlaceholderStyle}>Keine Eintragung</div>
              ) : null}
            </div>
          </div>
        );
      }

      return (
        <div style={cardStyle}>
          <div>
            <div style={cardTopRowStyle}>
              <div style={dayCardTitleStyle}>{dayLabels[day]}</div>
              <div style={dayCardDateStyle}>{getDateForDay(day)}</div>
            </div>

            <div
              style={{
                ...statusPillStyle,
                background: palette.badgeBg,
                color: palette.badgeColor,
              }}
            >
              {edit.status === "LEER" ? "LEER" : edit.status}
            </div>

            {specialLabel ? (
              <div style={specialLabelStyle}>{specialLabel}</div>
            ) : null}

            <select
              value={edit.status}
              onChange={(e) =>
                updateCell(employee.id, day, {
                  status: e.target.value as EditableShiftStatus,
                })
              }
              style={smallInputStyle}
            >
              <option value="LEER">-</option>
              <option value="ARBEIT">ARBEIT</option>
              <option value="FREI">FREI</option>
              <option value="FEIERTAG">FEIERTAG</option>
              <option value="URLAUB">URLAUB</option>
              <option value="KRANK">KRANK</option>
              <option value="SCHULUNG">SCHULUNG</option>
            </select>

            {edit.status === "ARBEIT" ? (
              <>
                <input
                  type="time"
                  value={edit.start}
                  onChange={(e) =>
                    updateCell(employee.id, day, {
                      start: e.target.value,
                    })
                  }
                  style={smallInputStyle}
                />

                <input
                  type="time"
                  value={edit.end}
                  onChange={(e) =>
                    updateCell(employee.id, day, {
                      end: e.target.value,
                    })
                  }
                  style={smallInputStyle}
                />

                <select
                  value={edit.location}
                  onChange={(e) =>
                    updateCell(employee.id, day, {
                      location: e.target.value as Location,
                    })
                  }
                  style={smallInputStyle}
                >
                  <option value="PF">PF</option>
                  <option value="KA">KA</option>
                </select>
              </>
            ) : null}

            <input
              value={edit.note}
              onChange={(e) =>
                updateCell(employee.id, day, {
                  note: e.target.value,
                })
              }
              placeholder="Notiz"
              style={smallInputStyle}
            />
          </div>
        </div>
      );
    }

    return (
      <>
        <PageHeader
          title="Wochenplan"
          subtitle={`${calendarWeekLabel} · Moderne Übersicht mit farbigen Tageskarten`}
          right={
            <div style={actionsWrapStyle}>
              <button
                onClick={() => setWeekStart((prev) => shiftIsoDate(prev, -7))}
                style={secondaryActionButtonStyle}
              >
                Vorwoche
              </button>
              <button
                onClick={() => setWeekStart((prev) => shiftIsoDate(prev, 7))}
                style={secondaryActionButtonStyle}
              >
                Nächste Woche
              </button>
              {showAdminActions ? (
                <button
                  onClick={copyPreviousWeekToCurrent}
                  style={secondaryActionButtonStyle}
                >
                  Vorwoche kopieren
                </button>
              ) : null}
              {showAdminActions ? (
                <button
                  onClick={saveAllVisibleWeeks}
                  style={primaryActionButtonStyle}
                >
                  Alle speichern
                </button>
              ) : null}
            </div>
          }
        />

        <div style={contentPanelStyle}>
          <div style={filtersBarStyle}>
            <div style={filterBoxStyle}>
              <label style={filterLabelStyle}>Name suchen</label>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="z. B. Dennis"
                style={modernInputStyle}
              />
            </div>

            <div style={filterBoxStyle}>
              <label style={filterLabelStyle}>Anstellungsart</label>
              <select
                value={employmentFilter}
                onChange={(e) =>
                  setEmploymentFilter(e.target.value as EmploymentFilter)
                }
                style={modernInputStyle}
              >
                <option value="Alle">Alle</option>
                <option value="Vollzeit">Vollzeit</option>
                <option value="Teilzeit">Teilzeit</option>
                <option value="Minijob">Minijob</option>
                <option value="Shop Manager">Shop Manager</option>
                <option value="Praktikant">Praktikant</option>
              </select>
            </div>

            <div style={filterBoxStyle}>
              <label style={filterLabelStyle}>Kalenderwoche</label>
              <input
                type="week"
                value={weekInputValue}
                onChange={(e) =>
                  setWeekStart(getMondayIsoFromWeekInput(e.target.value))
                }
                style={modernInputStyle}
              />
            </div>

            <div style={filterInfoStyle}>
              <div style={filterInfoTitleStyle}>Ausgewählt</div>
              <div style={filterInfoValueStyle}>{calendarWeekLabel}</div>
              <div style={filterInfoSubStyle}>Woche ab {weekStart}</div>
            </div>
          </div>

          <div style={{ ...actionsWrapStyle, marginBottom: "18px" }}>
            <button onClick={exportWeekCsv} style={secondaryActionButtonStyle}>
              Excel / CSV
            </button>
            <button onClick={printWeekPlan} style={secondaryActionButtonStyle}>
              Drucken / PDF
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {filteredEmployees.length === 0 ? (
              <div style={emptyStateStyle}>Keine Mitarbeiter gefunden.</div>
            ) : (
              filteredEmployees.map((employee) => {
                const isOwnRow = employee.id === linkedEmployeeId;

                return (
                  <div
                    key={employee.id}
                    style={{
                      ...employeeBlockStyle,
                      background: getOwnRowBackground(isOwnRow),
                      border: isOwnRow
                        ? "1px solid #bfdbfe"
                        : "1px solid #edf1f7",
                    }}
                  >
                    <div style={employeeBlockHeaderStyle}>
                      <div>
                        <div
                          style={{
                            ...employeeNameModernStyle,
                            color: isOwnRow ? "#2563eb" : "#111827",
                          }}
                        >
                          {employee.name}
                        </div>
                        <div style={employeeSubInfoStyle}>
                          {employee.employmentType}
                          {isOwnRow ? " · Deine Zeile" : ""}
                        </div>
                      </div>

                      <div style={summaryChipWrapStyle}>
                        <div style={summaryChipStyle}>
                          <div style={summaryChipLabelStyle}>Geplant</div>
                          <div style={summaryChipValueStyle}>
                            {formatHours(employeeWeekMinutes[employee.id] || 0)}
                          </div>
                        </div>
                        <div style={summaryChipStyle}>
                          <div style={summaryChipLabelStyle}>Soll</div>
                          <div style={summaryChipValueStyle}>
                            {formatHours(
                              weeklyTargetMinutesByEmployee[employee.id] || 0
                            )}
                          </div>
                        </div>
                        <div style={summaryChipStyle}>
                          <div style={summaryChipLabelStyle}>Differenz</div>
                          <div
                            style={{
                              ...summaryChipValueStyle,
                              color:
                                (weeklyDifferenceByEmployee[employee.id] || 0) > 0
                                  ? "#15803d"
                                  : (weeklyDifferenceByEmployee[employee.id] || 0) <
                                    0
                                  ? "#dc2626"
                                  : "#111827",
                            }}
                          >
                            {formatDifference(
                              weeklyDifferenceByEmployee[employee.id] || 0
                            )}
                          </div>
                        </div>
                        {showAdminActions ? (
                          <button
                            onClick={() => saveEmployeeWeek(employee.id)}
                            style={primaryActionButtonStyle}
                          >
                            Woche speichern
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div style={isMobile ? dayGridMobileStyle : dayGridStyle}>
                      {dayOrder.map((day) => (
                        <div key={day}>{renderPlanCard(employee, day, isOwnRow)}</div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </>
    );
  }

  function renderStempelzeiten() {
    const adminMode = authRole === "admin";

    return (
      <>
        <PageHeader
          title="Stempelzeiten"
          subtitle="Live-Übersicht von heute mit direktem Ein- und Ausstempeln"
          right={
            <button onClick={exportTimeEntriesCsv} style={secondaryActionButtonStyle}>
              Excel / CSV
            </button>
          }
        />

        <div style={dashboardGridStyle}>
          <InfoCard title="Heute eingestempelt">{activeStampedCount}</InfoCard>
          <InfoCard title="Heute nicht eingestempelt">
            {inactiveStampedCount}
          </InfoCard>
          <InfoCard title="Dein Status">
            {clockedIn
              ? `Eingestempelt seit ${openTimeEntry?.clockIn ?? ""}`
              : "Nicht eingestempelt"}
          </InfoCard>
          <InfoCard title="Deine Zeit heute">
            {formatHours(todayStampedMinutes)}
          </InfoCard>
        </div>

        <div style={contentPanelStyle}>
          <h3 style={panelTitleStyle}>Live-Status heute</h3>
          <div style={tableShellStyle}>
            <table style={modernTableStyle}>
              <thead>
                <tr>
                  <th style={modernThStyle}>Name</th>
                  <th style={modernThStyle}>Anstellungsart</th>
                  <th style={modernThStyle}>Status</th>
                  <th style={modernThStyle}>Kommen</th>
                  <th style={modernThStyle}>Gehen</th>
                  <th style={modernThStyle}>Heute</th>
                  <th style={modernThStyle}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {liveStampOverview.length === 0 ? (
                  <tr>
                    <td style={modernTdStyle} colSpan={7}>
                      Keine Mitarbeiter gefunden.
                    </td>
                  </tr>
                ) : (
                  liveStampOverview.map((item) => {
                    const isOwn = item.employee.id === linkedEmployeeId;

                    return (
                      <tr key={item.employee.id}>
                        <td
                          style={{
                            ...modernTdStyle,
                            fontWeight: 700,
                            color: isOwn ? "#2563eb" : "#111827",
                          }}
                        >
                          {item.employee.name}
                        </td>
                        <td style={modernTdStyle}>{item.employee.employmentType}</td>
                        <td style={modernTdStyle}>
                          {item.isActive ? (
                            <span style={statusBadgeGreen}>EINGESTEMPELT</span>
                          ) : (
                            <span style={statusBadgeGray}>NICHT EINGESTEMPELT</span>
                          )}
                        </td>
                        <td style={modernTdStyle}>
                          {item.openEntry?.clockIn || item.firstClockIn}
                        </td>
                        <td style={modernTdStyle}>
                          {item.isActive ? "-" : item.lastClockOut}
                        </td>
                        <td style={modernTdStyle}>
                          {formatHours(item.todayMinutes)}
                        </td>
                        <td style={modernTdStyle}>
                          <div style={actionsWrapStyle}>
                            {item.isActive ? (
                              <button
                                onClick={() =>
                                  adminMode
                                    ? handleAdminClockOut(
                                        item.employee.id,
                                        item.employee.name
                                      )
                                    : isOwn
                                    ? handleClockOut()
                                    : undefined
                                }
                                style={{
                                  ...dangerButtonStyle,
                                  opacity: adminMode || isOwn ? 1 : 0.5,
                                  cursor:
                                    adminMode || isOwn ? "pointer" : "not-allowed",
                                }}
                                disabled={!adminMode && !isOwn}
                              >
                                Ausstempeln
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  adminMode
                                    ? handleAdminClockIn(
                                        item.employee.id,
                                        item.employee.name
                                      )
                                    : isOwn
                                    ? handleClockIn()
                                    : undefined
                                }
                                style={{
                                  ...primaryActionButtonStyle,
                                  background: "#16a34a",
                                  opacity: adminMode || isOwn ? 1 : 0.5,
                                  cursor:
                                    adminMode || isOwn ? "pointer" : "not-allowed",
                                }}
                                disabled={!adminMode && !isOwn}
                              >
                                Einstempeln
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {adminMode ? (
          <div style={contentPanelStyle}>
            <h3 style={panelTitleStyle}>Manuelle Korrektur</h3>
            <div style={filtersBarStyle}>
              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Mitarbeiter</label>
                <select
                  value={correctionEmployeeId}
                  onChange={(e) => setCorrectionEmployeeId(e.target.value)}
                  style={modernInputStyle}
                >
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Datum</label>
                <input
                  type="date"
                  value={manualEntryDate}
                  onChange={(e) => setManualEntryDate(e.target.value)}
                  style={modernInputStyle}
                />
              </div>

              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Kommen</label>
                <input
                  type="time"
                  value={manualClockIn}
                  onChange={(e) => setManualClockIn(e.target.value)}
                  style={modernInputStyle}
                />
              </div>

              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Gehen</label>
                <input
                  type="time"
                  value={manualClockOut}
                  onChange={(e) => setManualClockOut(e.target.value)}
                  style={modernInputStyle}
                />
              </div>

              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Grund</label>
                <input
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  style={modernInputStyle}
                />
              </div>
            </div>

            <div style={{ marginTop: "16px" }}>
              <button onClick={addManualTimeEntry} style={primaryActionButtonStyle}>
                Manuelle Buchung speichern
              </button>
            </div>
          </div>
        ) : null}

        <div style={contentPanelStyle}>
          <h3 style={panelTitleStyle}>Historie / Kontrolle</h3>

          <div style={filtersBarStyle}>
            <div style={filterBoxStyle}>
              <label style={filterLabelStyle}>Mitarbeiter anzeigen</label>
              <select
                value={correctionEmployeeId}
                onChange={(e) => setCorrectionEmployeeId(e.target.value)}
                style={modernInputStyle}
              >
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={tableShellStyle}>
            <table style={modernTableStyle}>
              <thead>
                <tr>
                  <th style={modernThStyle}>Datum</th>
                  <th style={modernThStyle}>Kommen</th>
                  <th style={modernThStyle}>Gehen</th>
                  <th style={modernThStyle}>Minuten</th>
                  <th style={modernThStyle}>Manuell</th>
                  <th style={modernThStyle}>Grund</th>
                  {adminMode ? <th style={modernThStyle}>Aktion</th> : null}
                </tr>
              </thead>
              <tbody>
                {displayedTimeEntries.length === 0 ? (
                  <tr>
                    <td style={modernTdStyle} colSpan={adminMode ? 7 : 6}>
                      Keine Stempelzeiten gefunden.
                    </td>
                  </tr>
                ) : (
                  displayedTimeEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td style={modernTdStyle}>
                        {adminMode ? (
                          <input
                            type="date"
                            value={entry.entryDate}
                            onChange={(e) =>
                              updateTimeEntryLocal(entry.id, {
                                entryDate: e.target.value,
                              })
                            }
                            style={smallInputStyle}
                          />
                        ) : (
                          entry.entryDate
                        )}
                      </td>
                      <td style={modernTdStyle}>
                        {adminMode ? (
                          <input
                            type="time"
                            value={entry.clockIn}
                            onChange={(e) =>
                              updateTimeEntryLocal(entry.id, {
                                clockIn: e.target.value,
                              })
                            }
                            style={smallInputStyle}
                          />
                        ) : (
                          entry.clockIn
                        )}
                      </td>
                      <td style={modernTdStyle}>
                        {adminMode ? (
                          <input
                            type="time"
                            value={entry.clockOut}
                            onChange={(e) =>
                              updateTimeEntryLocal(entry.id, {
                                clockOut: e.target.value,
                              })
                            }
                            style={smallInputStyle}
                          />
                        ) : (
                          entry.clockOut || "-"
                        )}
                      </td>
                      <td style={modernTdStyle}>
                        {formatHours(calculateTimeEntryMinutes(entry))}
                      </td>
                      <td style={modernTdStyle}>
                        {adminMode ? (
                          <input
                            type="checkbox"
                            checked={entry.manualOverride}
                            onChange={(e) =>
                              updateTimeEntryLocal(entry.id, {
                                manualOverride: e.target.checked,
                              })
                            }
                          />
                        ) : entry.manualOverride ? (
                          "Ja"
                        ) : (
                          "Nein"
                        )}
                      </td>
                      <td style={modernTdStyle}>
                        {adminMode ? (
                          <input
                            value={entry.reason}
                            onChange={(e) =>
                              updateTimeEntryLocal(entry.id, {
                                reason: e.target.value,
                              })
                            }
                            style={smallInputStyle}
                          />
                        ) : (
                          entry.reason || "-"
                        )}
                      </td>
                      {adminMode ? (
                        <td style={modernTdStyle}>
                          <div style={actionsWrapStyle}>
                            <button
                              onClick={() => saveTimeEntry(entry)}
                              style={secondaryActionButtonStyle}
                            >
                              Speichern
                            </button>
                            <button
                              onClick={() => deleteTimeEntry(entry.id)}
                              style={dangerButtonStyle}
                            >
                              Löschen
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  function renderMitarbeiter() {
    return (
      <>
        <PageHeader
          title="Mitarbeiter"
          subtitle="Mitarbeiterdaten, Urlaub und Sollstunden verwalten"
        />

        {authRole === "admin" ? (
          <div style={contentPanelStyle}>
            <h3 style={panelTitleStyle}>
              {editingEmployeeId
                ? "Mitarbeiter bearbeiten"
                : "Mitarbeiter hinzufügen"}
            </h3>

            <div style={filtersBarStyle}>
              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={modernInputStyle}
                />
              </div>

              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Anstellungsart</label>
                <select
                  value={newEmploymentType}
                  onChange={(e) =>
                    setNewEmploymentType(e.target.value as EmploymentType)
                  }
                  style={modernInputStyle}
                >
                  <option value="Vollzeit">Vollzeit</option>
                  <option value="Teilzeit">Teilzeit</option>
                  <option value="Minijob">Minijob</option>
                  <option value="Shop Manager">Shop Manager</option>
                  <option value="Praktikant">Praktikant</option>
                </select>
              </div>

              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Urlaubstage gesamt</label>
                <input
                  value={newVacation}
                  onChange={(e) => setNewVacation(e.target.value)}
                  style={modernInputStyle}
                />
              </div>

              <div style={filterBoxStyle}>
                <label style={filterLabelStyle}>Sollstunden pro Woche</label>
                <input
                  type="number"
                  step="0.01"
                  value={newWeeklyTarget}
                  onChange={(e) => setNewWeeklyTarget(e.target.value)}
                  style={modernInputStyle}
                />
              </div>
            </div>

            <div style={{ ...actionsWrapStyle, marginTop: "16px" }}>
              <button onClick={addEmployee} style={primaryActionButtonStyle}>
                {editingEmployeeId
                  ? "Mitarbeiter aktualisieren"
                  : "Mitarbeiter speichern"}
              </button>
              {editingEmployeeId ? (
                <button
                  onClick={resetEmployeeForm}
                  style={secondaryActionButtonStyle}
                >
                  Bearbeiten abbrechen
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div style={contentPanelStyle}>
          <div style={filtersBarStyle}>
            <div style={filterBoxStyle}>
              <label style={filterLabelStyle}>Name suchen</label>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={modernInputStyle}
              />
            </div>

            <div style={filterBoxStyle}>
              <label style={filterLabelStyle}>Anstellungsart</label>
              <select
                value={employmentFilter}
                onChange={(e) =>
                  setEmploymentFilter(e.target.value as EmploymentFilter)
                }
                style={modernInputStyle}
              >
                <option value="Alle">Alle</option>
                <option value="Vollzeit">Vollzeit</option>
                <option value="Teilzeit">Teilzeit</option>
                <option value="Minijob">Minijob</option>
                <option value="Shop Manager">Shop Manager</option>
                <option value="Praktikant">Praktikant</option>
              </select>
            </div>
          </div>

          <div style={tableShellStyle}>
            <table style={modernTableStyle}>
              <thead>
                <tr>
                  <th style={modernThStyle}>Name</th>
                  <th style={modernThStyle}>Anstellungsart</th>
                  <th style={modernThStyle}>Urlaub gesamt</th>
                  <th style={modernThStyle}>Genommen {selectedVacationYear}</th>
                  <th style={modernThStyle}>Resturlaub {selectedVacationYear}</th>
                  <th style={modernThStyle}>Soll/Woche</th>
                  <th style={modernThStyle}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td style={modernTdStyle} colSpan={7}>
                      Keine Mitarbeiter gefunden.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((employee) => {
                    const vacation = vacationSummaryByEmployee[employee.id] || {
                      total: 0,
                      used: 0,
                      remaining: 0,
                    };

                    return (
                      <tr key={employee.id}>
                        <td style={{ ...modernTdStyle, fontWeight: 700 }}>
                          {employee.name}
                        </td>
                        <td style={modernTdStyle}>{employee.employmentType}</td>
                        <td style={modernTdStyle}>{vacation.total}</td>
                        <td style={modernTdStyle}>{vacation.used}</td>
                        <td style={{ ...modernTdStyle, fontWeight: 700 }}>
                          {vacation.remaining}
                        </td>
                        <td style={modernTdStyle}>{employee.weeklyTargetHours}</td>
                        <td style={modernTdStyle}>
                          {authRole === "admin" ? (
                            <div style={actionsWrapStyle}>
                              <button
                                onClick={() => startEditEmployee(employee)}
                                style={secondaryActionButtonStyle}
                              >
                                Bearbeiten
                              </button>
                              {employee.name.toLowerCase() === "admin" ? (
                                <span style={{ color: "#64748b" }}>Admin</span>
                              ) : (
                                <button
                                  onClick={() =>
                                    deleteEmployee(employee.id, employee.name)
                                  }
                                  style={dangerButtonStyle}
                                >
                                  Löschen
                                </button>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: "#64748b" }}>Nur lesen</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  function renderMonatsuebersicht() {
    return (
      <>
        <PageHeader
          title="Monatsübersicht"
          subtitle="Geplante und gestempelte Stunden im Monatsvergleich"
          right={
            <button onClick={exportMonthCsv} style={secondaryActionButtonStyle}>
              Excel / CSV
            </button>
          }
        />

        <div style={contentPanelStyle}>
          <div style={filtersBarStyle}>
            <div style={filterBoxStyle}>
              <label style={filterLabelStyle}>Monat</label>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                style={modernInputStyle}
              />
            </div>
          </div>

          <div style={tableShellStyle}>
            <table style={modernTableStyle}>
              <thead>
                <tr>
                  <th style={modernThStyle}>Name</th>
                  <th style={modernThStyle}>Anstellungsart</th>
                  <th style={modernThStyle}>Geplant</th>
                  <th style={modernThStyle}>Gestempelt</th>
                  <th style={modernThStyle}>Differenz</th>
                </tr>
              </thead>
              <tbody>
                {monthlyOverview.length === 0 ? (
                  <tr>
                    <td style={modernTdStyle} colSpan={5}>
                      Keine Daten gefunden.
                    </td>
                  </tr>
                ) : (
                  monthlyOverview.map((item) => (
                    <tr key={item.employee.id}>
                      <td style={{ ...modernTdStyle, fontWeight: 700 }}>
                        {item.employee.name}
                      </td>
                      <td style={modernTdStyle}>{item.employee.employmentType}</td>
                      <td style={modernTdStyle}>
                        {formatHours(item.plannedMinutes)}
                      </td>
                      <td style={modernTdStyle}>
                        {formatHours(item.stampedMinutes)}
                      </td>
                      <td
                        style={{
                          ...modernTdStyle,
                          fontWeight: 700,
                          color:
                            item.difference > 0
                              ? "#15803d"
                              : item.difference < 0
                              ? "#dc2626"
                              : "#111827",
                        }}
                      >
                        {formatDifference(item.difference)}
                      </td>
                    </tr>
                  ))
                )}

                <tr>
                  <td style={{ ...modernTdStyle, fontWeight: 700 }}>GESAMT</td>
                  <td style={modernTdStyle}>-</td>
                  <td style={{ ...modernTdStyle, fontWeight: 700 }}>
                    {formatHours(monthlyTotals.planned)}
                  </td>
                  <td style={{ ...modernTdStyle, fontWeight: 700 }}>
                    {formatHours(monthlyTotals.stamped)}
                  </td>
                  <td
                    style={{
                      ...modernTdStyle,
                      fontWeight: 700,
                      color:
                        monthlyTotals.diff > 0
                          ? "#15803d"
                          : monthlyTotals.diff < 0
                          ? "#dc2626"
                          : "#111827",
                    }}
                  >
                    {formatDifference(monthlyTotals.diff)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <main style={loadingPageStyle}>
        <div style={loadingCardStyle}>Lade Daten...</div>
      </main>
    );
  }

  if (!loggedIn) {
    return (
      <main style={loginPageStyle}>
        <div style={isMobile ? loginShellMobileStyle : loginShellStyle}>
          <div style={loginBrandBlockStyle}>
            <div style={loginBrandLogoStyle}>O2</div>
            <h1 style={loginBrandTitleStyle}>Arbeitszeit Tool</h1>
            <p style={loginBrandTextStyle}>
              Modernes Dashboard für Wochenplan, Stempelzeiten und Mitarbeiter.
            </p>
          </div>

          <div style={loginCardStyle}>
            <div style={eyebrowStyle}>Anmeldung</div>
            <h2 style={loginTitleStyle}>Willkommen zurück</h2>
            <p style={loginSubTextStyle}>
              Mit deiner Supabase-E-Mail und deinem Passwort anmelden.
            </p>

            <div style={{ marginBottom: "14px" }}>
              <label style={labelStyle}>E-Mail</label>
              <input
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="name@beispiel.de"
                style={modernInputStyle}
                autoComplete="email"
              />
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Passwort</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Passwort"
                style={modernInputStyle}
                autoComplete="current-password"
              />
            </div>

            <button onClick={handleLogin} style={loginButtonStyle}>
              Einloggen
            </button>
          </div>
        </div>
      </main>
    );
  }

  const sidebarItems: { key: AppTab; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "wochenplan", label: "Wochenplan" },
    { key: "stempelzeiten", label: "Stempelzeiten" },
    { key: "monatsuebersicht", label: "Monatsübersicht" },
    { key: "mitarbeiter", label: "Mitarbeiter" },
  ];

  return (
    <main style={isMobile ? appShellMobileStyle : appShellStyle}>
      {isMobile ? (
        <div
          style={{
            ...mobileOverlayStyle,
            display: mobileMenuOpen ? "block" : "none",
          }}
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}

      <aside
        style={
          isMobile
            ? {
                ...sidebarMobileStyle,
                transform: mobileMenuOpen
                  ? "translateX(0)"
                  : "translateX(-110%)",
              }
            : sidebarStyle
        }
      >
        <div>
          <div style={sidebarBrandStyle}>
            <div style={sidebarBrandLogoStyle}>O2</div>
            <div>
              <div style={sidebarBrandTitleStyle}>Arbeitszeit Tool</div>
              <div style={sidebarBrandSubStyle}>Shop Management</div>
            </div>
          </div>

          <div style={sidebarSectionLabelStyle}>Navigation</div>

          <nav style={sidebarNavStyle}>
            {sidebarItems.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setActiveTab(item.key);
                  closeMobileMenu();
                }}
                style={{
                  ...sidebarButtonStyle,
                  background:
                    activeTab === item.key
                      ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)"
                      : "transparent",
                  color: activeTab === item.key ? "#ffffff" : "#cbd5e1",
                  boxShadow:
                    activeTab === item.key
                      ? "0 10px 24px rgba(37,99,235,0.28)"
                      : "none",
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div>
          <div style={sidebarFooterCardStyle}>
            <div style={sidebarFooterNameStyle}>
              {authEmail || "Unbekannt"}
            </div>
            <div style={sidebarFooterRoleStyle}>{authRole || "-"}</div>
          </div>

          <button onClick={handleLogout} style={sidebarLogoutStyle}>
            Abmelden
          </button>
        </div>
      </aside>

      <section style={isMobile ? mainAreaMobileStyle : mainAreaStyle}>
        <header style={isMobile ? topHeaderMobileStyle : topHeaderStyle}>
          {isMobile ? (
            <button
              onClick={() => setMobileMenuOpen(true)}
              style={mobileMenuButtonStyle}
            >
              ☰ Menü
            </button>
          ) : null}

          <div>
            <div style={topHeaderEyebrowStyle}>Shop Übersicht</div>
            <h1 style={isMobile ? topHeaderTitleMobileStyle : topHeaderTitleStyle}>
              {activeTab === "dashboard" && "Dashboard"}
              {activeTab === "wochenplan" && "Wochenplan"}
              {activeTab === "stempelzeiten" && "Stempelzeiten"}
              {activeTab === "mitarbeiter" && "Mitarbeiter"}
              {activeTab === "monatsuebersicht" && "Monatsübersicht"}
            </h1>
          </div>

          <div style={isMobile ? topHeaderActionsMobileStyle : topHeaderActionsStyle}>
            <div style={isMobile ? topHeaderUserCardMobileStyle : topHeaderUserCardStyle}>
              <div style={topHeaderUserAvatarStyle}>
                {(authEmail || "U").slice(0, 1).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={topHeaderUserNameStyle}>{authEmail || "-"}</div>
                <div style={topHeaderUserRoleStyle}>{authRole || "-"}</div>
              </div>
            </div>

            <button
              onClick={clockedIn ? handleClockOut : handleClockIn}
              style={{
                ...primaryActionButtonStyle,
                background: clockedIn ? "#dc2626" : "#16a34a",
                width: isMobile ? "100%" : undefined,
              }}
            >
              {clockedIn ? "Ausstempeln" : "Einstempeln"}
            </button>
          </div>
        </header>

        <div style={isMobile ? mainContentMobileStyle : mainContentStyle}>
          {activeTab === "dashboard" ? renderDashboard() : null}
          {activeTab === "wochenplan" ? renderWochenplan() : null}
          {activeTab === "stempelzeiten" ? renderStempelzeiten() : null}
          {activeTab === "mitarbeiter" ? renderMitarbeiter() : null}
          {activeTab === "monatsuebersicht" ? renderMonatsuebersicht() : null}
        </div>
      </section>
    </main>
  );
}

function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right?: ReactNode;
}) {
  return (
    <div style={pageHeaderStyle}>
      <div>
        <div style={pageHeaderEyebrowStyle}>Bereich</div>
        <h2 style={pageHeaderTitleStyle}>{title}</h2>
        <p style={pageHeaderTextStyle}>{subtitle}</p>
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={infoCardStyle}>
      <div style={infoCardLabelStyle}>{title}</div>
      <div style={infoCardValueStyle}>{children}</div>
    </div>
  );
}

function QuickActionModern({
  title,
  text,
  onClick,
}: {
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={quickActionCardModernStyle}>
      <div style={quickActionTitleStyle}>{title}</div>
      <div style={quickActionTextStyle}>{text}</div>
    </button>
  );
}

const appShellStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#f4f7fb",
  display: "flex",
  fontFamily: 'Inter, Arial, "Segoe UI", Roboto, Helvetica, sans-serif',
  color: "#111827",
};

const appShellMobileStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#f4f7fb",
  display: "block",
  fontFamily: 'Inter, Arial, "Segoe UI", Roboto, Helvetica, sans-serif',
  color: "#111827",
};

const sidebarStyle: CSSProperties = {
  width: "280px",
  minWidth: "280px",
  height: "100vh",
  position: "sticky",
  top: 0,
  background: "linear-gradient(180deg, #0f274d 0%, #0a1c39 100%)",
  color: "white",
  padding: "24px 18px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  boxShadow: "10px 0 30px rgba(15,23,42,0.08)",
  overflowY: "auto",
};

const sidebarMobileStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "280px",
  height: "100vh",
  zIndex: 50,
  background: "linear-gradient(180deg, #0f274d 0%, #0a1c39 100%)",
  color: "white",
  padding: "24px 18px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  boxShadow: "20px 0 50px rgba(15,23,42,0.35)",
  transition: "transform 0.25s ease",
  overflowY: "auto",
};

const mobileOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.45)",
  zIndex: 40,
};

const sidebarBrandStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  marginBottom: "28px",
};

const sidebarBrandLogoStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "14px",
  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  fontSize: "18px",
};

const sidebarBrandTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 700,
};

const sidebarBrandSubStyle: CSSProperties = {
  fontSize: "12px",
  color: "#94a3b8",
};

const sidebarSectionLabelStyle: CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#94a3b8",
  marginBottom: "12px",
};

const sidebarNavStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const sidebarButtonStyle: CSSProperties = {
  width: "100%",
  border: "none",
  borderRadius: "14px",
  padding: "14px 16px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: "15px",
  cursor: "pointer",
};

const sidebarFooterCardStyle: CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "14px",
  marginBottom: "12px",
};

const sidebarFooterNameStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  wordBreak: "break-word",
};

const sidebarFooterRoleStyle: CSSProperties = {
  fontSize: "12px",
  color: "#cbd5e1",
  marginTop: "4px",
};

const sidebarLogoutStyle: CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "14px",
  padding: "12px 14px",
  background: "transparent",
  color: "#ffffff",
  fontWeight: 600,
  cursor: "pointer",
};

const mainAreaStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const mainAreaMobileStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
};

const topHeaderStyle: CSSProperties = {
  background: "#ffffff",
  borderBottom: "1px solid #e8edf5",
  padding: "22px 28px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "20px",
  flexWrap: "wrap",
};

const topHeaderMobileStyle: CSSProperties = {
  background: "#ffffff",
  borderBottom: "1px solid #e8edf5",
  padding: "14px 16px",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "14px",
};

const mobileMenuButtonStyle: CSSProperties = {
  border: "1px solid #dbe3ef",
  borderRadius: "14px",
  background: "#ffffff",
  color: "#0f172a",
  padding: "12px 14px",
  fontWeight: 800,
  cursor: "pointer",
  alignSelf: "flex-start",
};

const topHeaderEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 700,
};

const topHeaderTitleStyle: CSSProperties = {
  margin: "4px 0 0 0",
  fontSize: "28px",
  fontWeight: 800,
  color: "#0f172a",
};

const topHeaderTitleMobileStyle: CSSProperties = {
  margin: "4px 0 0 0",
  fontSize: "24px",
  fontWeight: 800,
  color: "#0f172a",
};

const topHeaderActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  flexWrap: "wrap",
};

const topHeaderActionsMobileStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "12px",
};

const topHeaderUserCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "10px 12px",
  borderRadius: "16px",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
};

const topHeaderUserCardMobileStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "10px 12px",
  borderRadius: "16px",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  overflow: "hidden",
};

const topHeaderUserAvatarStyle: CSSProperties = {
  width: "40px",
  minWidth: "40px",
  height: "40px",
  borderRadius: "50%",
  background: "#dbeafe",
  color: "#1d4ed8",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
};

const topHeaderUserNameStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  color: "#0f172a",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const topHeaderUserRoleStyle: CSSProperties = {
  fontSize: "12px",
  color: "#64748b",
};

const mainContentStyle: CSSProperties = {
  padding: "28px",
  display: "flex",
  flexDirection: "column",
  gap: "20px",
};

const mainContentMobileStyle: CSSProperties = {
  padding: "14px",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const pageHeaderStyle: CSSProperties = {
  background: "#ffffff",
  borderRadius: "24px",
  padding: "24px",
  border: "1px solid #e8edf5",
  boxShadow: "0 10px 30px rgba(15,23,42,0.04)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  flexWrap: "wrap",
};

const pageHeaderEyebrowStyle: CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#64748b",
  fontWeight: 700,
  marginBottom: "6px",
};

const pageHeaderTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "28px",
  color: "#0f172a",
};

const pageHeaderTextStyle: CSSProperties = {
  margin: "8px 0 0 0",
  color: "#64748b",
};

const contentPanelStyle: CSSProperties = {
  background: "#ffffff",
  borderRadius: "24px",
  padding: "24px",
  border: "1px solid #e8edf5",
  boxShadow: "0 10px 30px rgba(15,23,42,0.04)",
};

const warningBannerStyle: CSSProperties = {
  background: "#fff7ed",
  color: "#9a3412",
  border: "1px solid #fdba74",
  borderRadius: "18px",
  padding: "14px 16px",
};

const modernHeroStyle: CSSProperties = {
  background: "linear-gradient(135deg, #dbeafe 0%, #ffffff 70%)",
  borderRadius: "26px",
  padding: "26px",
  border: "1px solid #dbeafe",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "18px",
  flexWrap: "wrap",
};

const modernHeroMobileStyle: CSSProperties = {
  background: "linear-gradient(135deg, #dbeafe 0%, #ffffff 70%)",
  borderRadius: "24px",
  padding: "20px",
  border: "1px solid #dbeafe",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "18px",
};

const modernHeroEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#2563eb",
  fontWeight: 800,
};

const modernHeroTitleStyle: CSSProperties = {
  fontSize: "34px",
  margin: "6px 0 8px 0",
  color: "#0f172a",
};

const modernHeroTitleMobileStyle: CSSProperties = {
  fontSize: "28px",
  margin: "6px 0 8px 0",
  color: "#0f172a",
};

const modernHeroTextStyle: CSSProperties = {
  margin: 0,
  color: "#475569",
  maxWidth: "700px",
};

const heroButtonWrapStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
};

const dashboardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
};

const infoCardStyle: CSSProperties = {
  background: "#ffffff",
  borderRadius: "22px",
  padding: "22px",
  border: "1px solid #e8edf5",
  boxShadow: "0 10px 30px rgba(15,23,42,0.04)",
};

const infoCardLabelStyle: CSSProperties = {
  fontSize: "13px",
  color: "#64748b",
  marginBottom: "10px",
};

const infoCardValueStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 800,
  color: "#0f172a",
};

const quickActionsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "16px",
};

const quickActionCardModernStyle: CSSProperties = {
  background: "#ffffff",
  borderRadius: "22px",
  border: "1px solid #e8edf5",
  boxShadow: "0 10px 30px rgba(15,23,42,0.04)",
  padding: "20px",
  textAlign: "left",
  cursor: "pointer",
};

const quickActionTitleStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: "#0f172a",
  marginBottom: "8px",
};

const quickActionTextStyle: CSSProperties = {
  color: "#64748b",
  fontSize: "14px",
};

const primaryActionButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "14px",
  background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
  color: "#ffffff",
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 10px 24px rgba(37,99,235,0.22)",
};

const secondaryActionButtonStyle: CSSProperties = {
  border: "1px solid #dbe3ef",
  borderRadius: "14px",
  background: "#ffffff",
  color: "#0f172a",
  padding: "12px 18px",
  fontWeight: 700,
  cursor: "pointer",
};

const filtersBarStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
  marginBottom: "18px",
};

const filterBoxStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};

const filterLabelStyle: CSSProperties = {
  fontSize: "12px",
  color: "#64748b",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const modernInputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "13px 14px",
  borderRadius: "14px",
  border: "1px solid #dbe3ef",
  background: "#ffffff",
  color: "#111827",
  fontSize: "15px",
};

const filterInfoStyle: CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "18px",
  padding: "14px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

const filterInfoTitleStyle: CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#64748b",
  fontWeight: 800,
};

const filterInfoValueStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 800,
  color: "#0f172a",
  marginTop: "6px",
};

const filterInfoSubStyle: CSSProperties = {
  fontSize: "13px",
  color: "#64748b",
  marginTop: "4px",
};

const employeeBlockStyle: CSSProperties = {
  borderRadius: "24px",
  padding: "20px",
  boxShadow: "0 10px 24px rgba(15,23,42,0.04)",
};

const employeeBlockHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
  flexWrap: "wrap",
  marginBottom: "18px",
};

const employeeNameModernStyle: CSSProperties = {
  fontSize: "22px",
  fontWeight: 800,
};

const employeeSubInfoStyle: CSSProperties = {
  fontSize: "13px",
  color: "#64748b",
  marginTop: "4px",
};

const summaryChipWrapStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  alignItems: "stretch",
};

const summaryChipStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "16px",
  padding: "10px 14px",
  minWidth: "100px",
};

const summaryChipLabelStyle: CSSProperties = {
  fontSize: "11px",
  color: "#64748b",
  textTransform: "uppercase",
  fontWeight: 700,
  marginBottom: "4px",
};

const summaryChipValueStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: 800,
  color: "#0f172a",
};

const dayGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "12px",
};

const dayGridMobileStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "12px",
};

const cardTopRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  marginBottom: "8px",
};

const dayCardTitleStyle: CSSProperties = {
  fontSize: "14px",
  fontWeight: 800,
  color: "#111827",
};

const dayCardDateStyle: CSSProperties = {
  fontSize: "12px",
  color: "#64748b",
};

const statusPillStyle: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  fontWeight: 800,
  fontSize: "11px",
  marginBottom: "10px",
};

const specialLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#b91c1c",
  marginBottom: "8px",
};

const timeBigStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
  color: "#111827",
  marginBottom: "6px",
};

const subInfoStyle: CSSProperties = {
  fontSize: "12px",
  color: "#475569",
  marginBottom: "8px",
};

const noteTextStyle: CSSProperties = {
  fontSize: "12px",
  color: "#475569",
};

const notePlaceholderStyle: CSSProperties = {
  fontSize: "12px",
  color: "#94a3b8",
};

const panelTitleStyle: CSSProperties = {
  margin: "0 0 16px 0",
  fontSize: "22px",
  color: "#0f172a",
};

const tableShellStyle: CSSProperties = {
  overflowX: "auto",
};

const modernTableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  minWidth: "920px",
};

const modernThStyle: CSSProperties = {
  textAlign: "left",
  padding: "14px 16px",
  background: "#f8fafc",
  color: "#475569",
  fontSize: "13px",
  fontWeight: 800,
  borderBottom: "1px solid #e2e8f0",
};

const modernTdStyle: CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid #eef2f7",
  color: "#111827",
  fontSize: "14px",
  verticalAlign: "middle",
};

const emptyStateStyle: CSSProperties = {
  padding: "28px",
  borderRadius: "20px",
  background: "#ffffff",
  border: "1px dashed #cbd5e1",
  color: "#64748b",
};

const loginPageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, #eaf2ff 0%, #f8fbff 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  fontFamily: 'Inter, Arial, "Segoe UI", Roboto, Helvetica, sans-serif',
};

const loginShellStyle: CSSProperties = {
  width: "100%",
  maxWidth: "1080px",
  display: "grid",
  gridTemplateColumns: "1fr 480px",
  gap: "24px",
  alignItems: "stretch",
};

const loginShellMobileStyle: CSSProperties = {
  width: "100%",
  maxWidth: "520px",
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "18px",
  alignItems: "stretch",
};

const loginBrandBlockStyle: CSSProperties = {
  background: "linear-gradient(135deg, #0f274d 0%, #153869 100%)",
  borderRadius: "32px",
  color: "#ffffff",
  padding: "36px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  boxShadow: "0 20px 50px rgba(15,39,77,0.22)",
};

const loginBrandLogoStyle: CSSProperties = {
  width: "64px",
  height: "64px",
  borderRadius: "18px",
  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 800,
  fontSize: "24px",
  marginBottom: "18px",
};

const loginBrandTitleStyle: CSSProperties = {
  fontSize: "38px",
  fontWeight: 800,
  margin: "0 0 10px 0",
};

const loginBrandTextStyle: CSSProperties = {
  margin: 0,
  color: "#cbd5e1",
  fontSize: "16px",
  lineHeight: 1.6,
  maxWidth: "420px",
};

const loginCardStyle: CSSProperties = {
  background: "#ffffff",
  borderRadius: "32px",
  padding: "34px",
  boxShadow: "0 20px 50px rgba(15,23,42,0.10)",
  border: "1px solid #e8edf5",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

const loginTitleStyle: CSSProperties = {
  fontSize: "30px",
  color: "#0f172a",
  margin: "6px 0 10px 0",
};

const loginSubTextStyle: CSSProperties = {
  color: "#64748b",
  margin: "0 0 24px 0",
};

const loginButtonStyle: CSSProperties = {
  width: "100%",
  border: "none",
  borderRadius: "14px",
  background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
  color: "#ffffff",
  padding: "14px 18px",
  fontWeight: 800,
  cursor: "pointer",
  boxShadow: "0 10px 24px rgba(37,99,235,0.22)",
};

const loadingPageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  background: "#f4f7fb",
  fontFamily: 'Inter, Arial, "Segoe UI", Roboto, Helvetica, sans-serif',
};

const loadingCardStyle: CSSProperties = {
  background: "#ffffff",
  padding: "24px 30px",
  borderRadius: "20px",
  boxShadow: "0 10px 30px rgba(15,23,42,0.08)",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: "8px",
  fontWeight: 700,
  color: "#334155",
};

const smallInputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: "10px",
  border: "1px solid #dbe3ef",
  fontSize: "12px",
  background: "#fff",
  color: "#111827",
  marginBottom: "6px",
};

const actionsWrapStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  color: "#2563eb",
  fontWeight: 800,
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const dangerButtonStyle: CSSProperties = {
  padding: "11px 16px",
  borderRadius: "12px",
  border: "none",
  background: "#dc2626",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
};

const statusBadgeGray: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#e5e7eb",
  color: "#374151",
  fontWeight: 800,
  fontSize: "12px",
};

const statusBadgeGreen: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#dcfce7",
  color: "#15803d",
  fontWeight: 800,
  fontSize: "12px",
};
