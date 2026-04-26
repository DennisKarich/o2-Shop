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
  | "monatsuebersicht"
  | "stempelzeiten"
  | "mitarbeiter";
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

  function renderPlanReadOnly(edit: WeeklyEdit) {
    if (edit.status === "LEER") {
      return <span style={{ color: "#888" }}>-</span>;
    }

    if (edit.status === "ARBEIT") {
      return (
        <div>
          <div style={statusBadgeBlue}>ARBEIT</div>
          <div style={{ marginTop: "6px", fontWeight: "bold" }}>
            ({edit.location}) {edit.start}-{edit.end}
          </div>
          {edit.note ? (
            <div style={{ marginTop: "6px", color: "#5f6368", fontSize: "12px" }}>
              {edit.note}
            </div>
          ) : null}
        </div>
      );
    }

    const style =
      edit.status === "FEIERTAG"
        ? statusBadgeRed
        : edit.status === "URLAUB"
        ? statusBadgeGreen
        : edit.status === "KRANK"
        ? statusBadgeOrange
        : edit.status === "SCHULUNG"
        ? statusBadgeYellow
        : statusBadgeGray;

    return (
      <div>
        <div style={style}>{edit.status}</div>
        {edit.note ? (
          <div style={{ marginTop: "6px", color: "#5f6368", fontSize: "12px" }}>
            {edit.note}
          </div>
        ) : null}
      </div>
    );
  }

  function renderDashboard() {
    const currentVacationSummary = currentEmployee
      ? vacationSummaryByEmployee[currentEmployee.id]
      : undefined;

    return (
      <>
        <div style={heroCardStyle}>
          <div>
            <div style={eyebrowStyle}>Arbeitszeit Tool</div>
            <h2 style={{ margin: "6px 0 10px 0", fontSize: "30px", color: "#111" }}>
              Übersicht auf einen Blick
            </h2>
            <p style={{ margin: 0, color: "#5f6368", maxWidth: "700px" }}>
              Login aktiv. Rolle: <strong>{authRole ?? "-"}</strong> · Konto{" "}
              <strong>{authEmail || "-"}</strong>
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button onClick={() => setActiveTab("wochenplan")} style={primaryButtonStyle}>
              Zum Wochenplan
            </button>
            <button
              onClick={() => setActiveTab("monatsuebersicht")}
              style={secondaryButtonStyle}
            >
              Monatsübersicht
            </button>
          </div>
        </div>

        {!currentEmployee ? (
          <div style={warningCardStyle}>
            Dein Login ist noch keinem Mitarbeiter zugeordnet. Alles ansehen geht
            trotzdem, aber Ein- und Ausstempeln geht erst nach der Verknüpfung.
          </div>
        ) : null}

        <div style={statsGridStyle}>
          <StatCard title="Status">
            {clockedIn
              ? `Eingestempelt seit ${openTimeEntry?.clockIn ?? ""}`
              : "Nicht eingestempelt"}
          </StatCard>

          <StatCard title="Geplante Stunden diese Woche">
            {formatHours(employeeWeekMinutes[currentEmployee?.id || ""] || 0)}
          </StatCard>

          <StatCard title="Sollstunden diese Woche">
            {formatHours(
              weeklyTargetMinutesByEmployee[currentEmployee?.id || ""] || 0
            )}
          </StatCard>

          <StatCard title="Überstunden / Minusstunden Woche">
            {formatDifference(
              weeklyDifferenceByEmployee[currentEmployee?.id || ""] || 0
            )}
          </StatCard>

          <StatCard title="Gestempelte Monatsstunden">
            {formatHours(monthStampedMinutes)}
          </StatCard>

          <StatCard title={`Resturlaub ${selectedVacationYear}`}>
            {currentVacationSummary
              ? `${currentVacationSummary.remaining} Tage`
              : "0 Tage"}
          </StatCard>
        </div>

        <div style={dashboardActionsGridStyle}>
          <QuickActionCard
            title="Wochenplan"
            text={
              authRole === "admin"
                ? "Dienstplan direkt in der Tabelle pflegen."
                : "Kompletten Plan ansehen."
            }
            button="Öffnen"
            onClick={() => setActiveTab("wochenplan")}
          />
          <QuickActionCard
            title="Monatsübersicht"
            text="Geplante und gestempelte Stunden vergleichen."
            button="Anzeigen"
            onClick={() => setActiveTab("monatsuebersicht")}
          />
          <QuickActionCard
            title="Stempelzeiten"
            text={
              authRole === "admin"
                ? "Live sehen, wer drin ist, und direkt ein-/ausstempeln."
                : "Alle Stempelzeiten ansehen."
            }
            button="Öffnen"
            onClick={() => setActiveTab("stempelzeiten")}
          />
          <QuickActionCard
            title="Mitarbeiter"
            text={
              authRole === "admin"
                ? "Mitarbeiter anlegen, bearbeiten und löschen."
                : "Mitarbeiterliste ansehen."
            }
            button="Öffnen"
            onClick={() => setActiveTab("mitarbeiter")}
          />
        </div>
      </>
    );
  }

  function renderWochenplan() {
    const showAdminActions = authRole === "admin";

    function getOwnRowBackground(isOwnRow: boolean) {
      return isOwnRow ? "#eff6ff" : "#ffffff";
    }

    function getStatusPalette(status: EditableShiftStatus) {
      switch (status) {
        case "ARBEIT":
          return {
            bg: "#dbeafe",
            border: "#93c5fd",
            badgeBg: "#2563eb",
            badgeColor: "#ffffff",
          };
        case "FREI":
          return {
            bg: "#f3f4f6",
            border: "#d1d5db",
            badgeBg: "#6b7280",
            badgeColor: "#ffffff",
          };
        case "URLAUB":
          return {
            bg: "#dcfce7",
            border: "#86efac",
            badgeBg: "#16a34a",
            badgeColor: "#ffffff",
          };
        case "KRANK":
          return {
            bg: "#ffedd5",
            border: "#fdba74",
            badgeBg: "#ea580c",
            badgeColor: "#ffffff",
          };
        case "SCHULUNG":
          return {
            bg: "#fef3c7",
            border: "#fcd34d",
            badgeBg: "#ca8a04",
            badgeColor: "#ffffff",
          };
        case "FEIERTAG":
          return {
            bg: "#fee2e2",
            border: "#fca5a5",
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
        padding: "10px",
        minHeight: "165px",
        boxShadow: isOwnRow
          ? "0 0 0 2px rgba(37,99,235,0.18)"
          : "0 4px 10px rgba(15,23,42,0.05)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      };

      if (authRole !== "admin") {
        return (
          <div style={cardStyle}>
            <div>
              <div
                style={{
                  display: "inline-block",
                  padding: "4px 8px",
                  borderRadius: "999px",
                  background: palette.badgeBg,
                  color: palette.badgeColor,
                  fontWeight: "bold",
                  fontSize: "11px",
                  marginBottom: "10px",
                }}
              >
                {edit.status === "LEER" ? "LEER" : edit.status}
              </div>

              <div style={{ fontSize: "14px", fontWeight: "bold", color: "#111" }}>
                {dayLabels[day]}
              </div>

              <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px" }}>
                {getDateForDay(day)}
              </div>

              {specialLabel ? (
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: "bold",
                    color: "#b91c1c",
                    marginBottom: "8px",
                  }}
                >
                  {specialLabel}
                </div>
              ) : null}

              {edit.status === "ARBEIT" ? (
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: "bold",
                    color: "#111",
                    marginBottom: "8px",
                  }}
                >
                  {edit.start} - {edit.end}
                </div>
              ) : null}

              {edit.status === "ARBEIT" ? (
                <div style={{ fontSize: "12px", color: "#374151", marginBottom: "8px" }}>
                  Standort: {edit.location}
                </div>
              ) : null}

              {edit.note ? (
                <div style={{ fontSize: "12px", color: "#4b5563" }}>{edit.note}</div>
              ) : null}

              {edit.status === "LEER" ? (
                <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                  Keine Eintragung
                </div>
              ) : null}
            </div>
          </div>
        );
      }

      return (
        <div style={cardStyle}>
          <div>
            <div
              style={{
                display: "inline-block",
                padding: "4px 8px",
                borderRadius: "999px",
                background: palette.badgeBg,
                color: palette.badgeColor,
                fontWeight: "bold",
                fontSize: "11px",
                marginBottom: "10px",
              }}
            >
              {edit.status === "LEER" ? "LEER" : edit.status}
            </div>

            <div style={{ fontSize: "14px", fontWeight: "bold", color: "#111" }}>
              {dayLabels[day]}
            </div>

            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px" }}>
              {getDateForDay(day)}
            </div>

            {specialLabel ? (
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "#b91c1c",
                  marginBottom: "8px",
                }}
              >
                {specialLabel}
              </div>
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
        <div style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Wochenplan</h2>
              <p style={sectionTextStyle}>
                {calendarWeekLabel} · Moderne Übersicht mit farbigen Tageskarten.
              </p>
            </div>

            <div style={actionsWrapStyle}>
              <button
                onClick={() => setWeekStart((prev) => shiftIsoDate(prev, -7))}
                style={secondaryButtonStyle}
              >
                Vorwoche
              </button>
              <button
                onClick={() => setWeekStart((prev) => shiftIsoDate(prev, 7))}
                style={secondaryButtonStyle}
              >
                Nächste Woche
              </button>

              {showAdminActions ? (
                <button
                  onClick={copyPreviousWeekToCurrent}
                  style={secondaryButtonStyle}
                >
                  Vorwoche kopieren
                </button>
              ) : null}

              {showAdminActions ? (
                <button
                  onClick={saveAllVisibleWeeks}
                  style={primaryButtonStyle}
                >
                  Alle sichtbaren Zeilen speichern
                </button>
              ) : null}
            </div>
          </div>

          <div style={filtersGridStyle}>
            <div>
              <label style={labelStyle}>Name suchen</label>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="z. B. Dennis"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Anstellungsart filtern</label>
              <select
                value={employmentFilter}
                onChange={(e) =>
                  setEmploymentFilter(e.target.value as EmploymentFilter)
                }
                style={inputStyle}
              >
                <option value="Alle">Alle</option>
                <option value="Vollzeit">Vollzeit</option>
                <option value="Teilzeit">Teilzeit</option>
                <option value="Minijob">Minijob</option>
                <option value="Shop Manager">Shop Manager</option>
                <option value="Praktikant">Praktikant</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>Kalenderwoche</label>
              <input
                type="week"
                value={weekInputValue}
                onChange={(e) =>
                  setWeekStart(getMondayIsoFromWeekInput(e.target.value))
                }
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginTop: "12px", color: "#5f6368", fontSize: "14px" }}>
            Ausgewählt: <strong>{calendarWeekLabel}</strong> · Woche ab{" "}
            <strong>{weekStart}</strong>
          </div>

          <div style={{ ...actionsWrapStyle, marginTop: "15px" }}>
            <button onClick={exportWeekCsv} style={secondaryButtonStyle}>
              Wochenplan Excel/CSV
            </button>
            <button onClick={printWeekPlan} style={secondaryButtonStyle}>
              Wochenplan PDF / Drucken
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {filteredEmployees.length === 0 ? (
            <div style={sectionStyle}>Keine Mitarbeiter gefunden.</div>
          ) : (
            filteredEmployees.map((employee) => {
              const isOwnRow = employee.id === linkedEmployeeId;

              return (
                <div
                  key={employee.id}
                  style={{
                    ...sectionStyle,
                    padding: "18px",
                    border: isOwnRow ? "2px solid #93c5fd" : "1px solid transparent",
                    background: getOwnRowBackground(isOwnRow),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                      marginBottom: "16px",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "20px",
                          fontWeight: "bold",
                          color: isOwnRow ? "#1d4ed8" : "#111",
                        }}
                      >
                        {employee.name}
                      </div>
                      <div
                        style={{
                          color: "#6b7280",
                          fontSize: "13px",
                          marginTop: "4px",
                        }}
                      >
                        {employee.employmentType}
                        {isOwnRow ? " · Deine Zeile" : ""}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: "10px",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={summaryMiniBoxStyle}>
                        <div style={summaryMiniLabelStyle}>Geplant</div>
                        <div style={summaryMiniValueStyle}>
                          {formatHours(employeeWeekMinutes[employee.id] || 0)}
                        </div>
                      </div>

                      <div style={summaryMiniBoxStyle}>
                        <div style={summaryMiniLabelStyle}>Soll</div>
                        <div style={summaryMiniValueStyle}>
                          {formatHours(weeklyTargetMinutesByEmployee[employee.id] || 0)}
                        </div>
                      </div>

                      <div style={summaryMiniBoxStyle}>
                        <div style={summaryMiniLabelStyle}>Differenz</div>
                        <div
                          style={{
                            ...summaryMiniValueStyle,
                            color:
                              (weeklyDifferenceByEmployee[employee.id] || 0) > 0
                                ? "#15803d"
                                : (weeklyDifferenceByEmployee[employee.id] || 0) < 0
                                ? "#b91c1c"
                                : "#111",
                          }}
                        >
                          {formatDifference(weeklyDifferenceByEmployee[employee.id] || 0)}
                        </div>
                      </div>

                      {showAdminActions ? (
                        <button
                          onClick={() => saveEmployeeWeek(employee.id)}
                          style={primaryButtonStyle}
                        >
                          Woche speichern
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    {dayOrder.map((day) => (
                      <div key={day}>{renderPlanCard(employee, day, isOwnRow)}</div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </>
    );
  }

  function renderMonatsuebersicht() {
    return (
      <>
        <div style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Monatsübersicht</h2>
              <p style={sectionTextStyle}>
                Vergleicht geplante Stunden mit den gestempelten Zeiten.
              </p>
            </div>
            <div style={actionsWrapStyle}>
              <button onClick={exportMonthCsv} style={secondaryButtonStyle}>
                Monatsübersicht Excel/CSV
              </button>
            </div>
          </div>

          <div style={{ maxWidth: "220px" }}>
            <label style={labelStyle}>Monat</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ ...sectionStyle, overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: "900px",
            }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Anstellungsart</th>
                <th style={thStyle}>Geplant</th>
                <th style={thStyle}>Gestempelt</th>
                <th style={thStyle}>Differenz</th>
              </tr>
            </thead>
            <tbody>
              {monthlyOverview.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    Keine Daten gefunden.
                  </td>
                </tr>
              ) : (
                monthlyOverview.map((item) => (
                  <tr key={item.employee.id}>
                    <td style={nameCellStyle}>{item.employee.name}</td>
                    <td style={tableCellStyle}>{item.employee.employmentType}</td>
                    <td style={tableCellStyle}>{formatHours(item.plannedMinutes)}</td>
                    <td style={tableCellStyle}>{formatHours(item.stampedMinutes)}</td>
                    <td
                      style={{
                        ...tableCellStyle,
                        fontWeight: "bold",
                        color:
                          item.difference > 0
                            ? "#15803d"
                            : item.difference < 0
                            ? "#b91c1c"
                            : "#111",
                      }}
                    >
                      {formatDifference(item.difference)}
                    </td>
                  </tr>
                ))
              )}

              <tr style={{ background: "#f9fafb" }}>
                <td style={nameCellStyle}>GESAMT</td>
                <td style={tableCellStyle}>-</td>
                <td style={tableCellStyle}>{formatHours(monthlyTotals.planned)}</td>
                <td style={tableCellStyle}>{formatHours(monthlyTotals.stamped)}</td>
                <td
                  style={{
                    ...tableCellStyle,
                    fontWeight: "bold",
                    color:
                      monthlyTotals.diff > 0
                        ? "#15803d"
                        : monthlyTotals.diff < 0
                        ? "#b91c1c"
                        : "#111",
                  }}
                >
                  {formatDifference(monthlyTotals.diff)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function renderStempelzeiten() {
    const adminMode = authRole === "admin";

    return (
      <>
        <div style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Stempelzeiten</h2>
              <p style={sectionTextStyle}>
                Live-Übersicht von heute. Du siehst direkt, wer eingestempelt ist,
                und kannst auf derselben Seite ein- oder ausstempeln.
              </p>
            </div>
            <div style={actionsWrapStyle}>
              <button onClick={exportTimeEntriesCsv} style={secondaryButtonStyle}>
                Stempelzeiten Excel/CSV
              </button>
            </div>
          </div>

          <div style={statsGridStyle}>
            <StatCard title="Heute eingestempelt">{activeStampedCount}</StatCard>
            <StatCard title="Heute nicht eingestempelt">
              {inactiveStampedCount}
            </StatCard>
            <StatCard title="Dein Status">
              {clockedIn
                ? `Eingestempelt seit ${openTimeEntry?.clockIn ?? ""}`
                : "Nicht eingestempelt"}
            </StatCard>
            <StatCard title="Deine Zeit heute">
              {formatHours(todayStampedMinutes)}
            </StatCard>
          </div>
        </div>

        <div style={{ ...sectionStyle, overflowX: "auto" }}>
          <h2 style={sectionTitleStyle}>Live-Status heute</h2>
          <p style={sectionTextStyle}>
            Hier siehst du alle Mitarbeiter auf einen Blick.
          </p>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: "1100px",
              marginTop: "16px",
            }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Anstellungsart</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Kommen</th>
                <th style={thStyle}>Gehen</th>
                <th style={thStyle}>Heute</th>
                <th style={thStyle}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {liveStampOverview.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={7}>
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
                          ...nameCellStyle,
                          background: isOwn ? "#dbeafe" : "#fff",
                          color: isOwn ? "#1d4ed8" : "#111",
                        }}
                      >
                        {item.employee.name}
                        {isOwn ? (
                          <div style={{ fontSize: "11px", marginTop: "4px" }}>
                            Dein Login
                          </div>
                        ) : null}
                      </td>
                      <td style={tableCellStyle}>{item.employee.employmentType}</td>
                      <td style={tableCellStyle}>
                        {item.isActive ? (
                          <span style={statusBadgeGreen}>EINGESTEMPELT</span>
                        ) : (
                          <span style={statusBadgeGray}>NICHT EINGESTEMPELT</span>
                        )}
                      </td>
                      <td style={tableCellStyle}>
                        {item.openEntry?.clockIn || item.firstClockIn}
                      </td>
                      <td style={tableCellStyle}>
                        {item.isActive ? "-" : item.lastClockOut}
                      </td>
                      <td style={tableCellStyle}>
                        {formatHours(item.todayMinutes)}
                      </td>
                      <td style={tableCellStyle}>
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
                                ...primaryButtonStyle,
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

        {adminMode ? (
          <div style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Manuelle Korrektur</h2>
            <p style={sectionTextStyle}>Für Nachbuchungen oder Korrekturen.</p>

            <div style={filtersGridStyle}>
              <div>
                <label style={labelStyle}>Mitarbeiter</label>
                <select
                  value={correctionEmployeeId}
                  onChange={(e) => setCorrectionEmployeeId(e.target.value)}
                  style={inputStyle}
                >
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Datum</label>
                <input
                  type="date"
                  value={manualEntryDate}
                  onChange={(e) => setManualEntryDate(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Kommen</label>
                <input
                  type="time"
                  value={manualClockIn}
                  onChange={(e) => setManualClockIn(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Gehen</label>
                <input
                  type="time"
                  value={manualClockOut}
                  onChange={(e) => setManualClockOut(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Grund</label>
                <input
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  placeholder="z. B. vergessen zu stempeln"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ ...actionsWrapStyle, marginTop: "15px" }}>
              <button onClick={addManualTimeEntry} style={primaryButtonStyle}>
                Manuelle Buchung speichern
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ ...sectionStyle, overflowX: "auto" }}>
          <h2 style={sectionTitleStyle}>Historie / Kontrolle</h2>
          <p style={sectionTextStyle}>
            Einzelne Einträge prüfen und bei Bedarf korrigieren.
          </p>

          <div style={{ ...filtersGridStyle, marginTop: "16px" }}>
            <div>
              <label style={labelStyle}>Mitarbeiter anzeigen</label>
              <select
                value={correctionEmployeeId}
                onChange={(e) => setCorrectionEmployeeId(e.target.value)}
                style={inputStyle}
              >
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: adminMode ? "1100px" : "800px",
              marginTop: "16px",
            }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={thStyle}>Datum</th>
                <th style={thStyle}>Kommen</th>
                <th style={thStyle}>Gehen</th>
                <th style={thStyle}>Minuten</th>
                <th style={thStyle}>Manuell</th>
                <th style={thStyle}>Grund</th>
                {adminMode ? <th style={thStyle}>Aktion</th> : null}
              </tr>
            </thead>
            <tbody>
              {displayedTimeEntries.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={adminMode ? 7 : 6}>
                    Keine Stempelzeiten gefunden.
                  </td>
                </tr>
              ) : (
                displayedTimeEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td style={tableCellStyle}>
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

                    <td style={tableCellStyle}>
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

                    <td style={tableCellStyle}>
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

                    <td style={tableCellStyle}>
                      {formatHours(calculateTimeEntryMinutes(entry))}
                    </td>

                    <td style={tableCellStyle}>
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

                    <td style={tableCellStyle}>
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
                      <td style={tableCellStyle}>
                        <div style={actionsWrapStyle}>
                          <button
                            onClick={() => saveTimeEntry(entry)}
                            style={secondaryButtonStyle}
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
      </>
    );
  }

  function renderMitarbeiter() {
    return (
      <>
        {authRole === "admin" ? (
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>
                  {editingEmployeeId
                    ? "Mitarbeiter bearbeiten"
                    : "Mitarbeiter hinzufügen"}
                </h2>
                <p style={sectionTextStyle}>
                  Hier trägst du den Jahresurlaub und die Sollstunden pro Woche ein.
                </p>
              </div>
            </div>

            <div style={filtersGridStyle}>
              <div>
                <label style={labelStyle}>Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Anstellungsart</label>
                <select
                  value={newEmploymentType}
                  onChange={(e) =>
                    setNewEmploymentType(e.target.value as EmploymentType)
                  }
                  style={inputStyle}
                >
                  <option value="Vollzeit">Vollzeit</option>
                  <option value="Teilzeit">Teilzeit</option>
                  <option value="Minijob">Minijob</option>
                  <option value="Shop Manager">Shop Manager</option>
                  <option value="Praktikant">Praktikant</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Urlaubstage gesamt</label>
                <input
                  value={newVacation}
                  onChange={(e) => setNewVacation(e.target.value)}
                  placeholder="z. B. 30"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Sollstunden pro Woche</label>
                <input
                  type="number"
                  step="0.01"
                  value={newWeeklyTarget}
                  onChange={(e) => setNewWeeklyTarget(e.target.value)}
                  placeholder="z. B. 40"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ ...actionsWrapStyle, marginTop: "15px" }}>
              <button onClick={addEmployee} style={primaryButtonStyle}>
                {editingEmployeeId
                  ? "Mitarbeiter aktualisieren"
                  : "Mitarbeiter speichern"}
              </button>

              {editingEmployeeId ? (
                <button onClick={resetEmployeeForm} style={secondaryButtonStyle}>
                  Bearbeiten abbrechen
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div style={sectionStyle}>
          <div style={filtersGridStyle}>
            <div>
              <label style={labelStyle}>Name suchen</label>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="z. B. Dennis"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Anstellungsart filtern</label>
              <select
                value={employmentFilter}
                onChange={(e) =>
                  setEmploymentFilter(e.target.value as EmploymentFilter)
                }
                style={inputStyle}
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
        </div>

        <div style={{ ...sectionStyle, overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: "1200px",
            }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Anstellungsart</th>
                <th style={thStyle}>Urlaub gesamt</th>
                <th style={thStyle}>Genommen {selectedVacationYear}</th>
                <th style={thStyle}>Resturlaub {selectedVacationYear}</th>
                <th style={thStyle}>Soll/Woche</th>
                <th style={thStyle}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={7}>
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
                      <td style={nameCellStyle}>{employee.name}</td>
                      <td style={tableCellStyle}>{employee.employmentType}</td>
                      <td style={tableCellStyle}>{vacation.total}</td>
                      <td style={tableCellStyle}>{vacation.used}</td>
                      <td style={{ ...tableCellStyle, fontWeight: "bold" }}>
                        {vacation.remaining}
                      </td>
                      <td style={tableCellStyle}>{employee.weeklyTargetHours}</td>
                      <td style={tableCellStyle}>
                        {authRole === "admin" ? (
                          <div style={actionsWrapStyle}>
                            <button
                              onClick={() => startEditEmployee(employee)}
                              style={secondaryButtonStyle}
                            >
                              Bearbeiten
                            </button>

                            {employee.name.toLowerCase() === "admin" ? (
                              <span style={{ color: "#666", alignSelf: "center" }}>
                                Admin
                              </span>
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
                          <span style={{ color: "#666" }}>Nur lesen</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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
        <div style={loginCardStyle}>
          <div style={eyebrowStyle}>Arbeitszeit Tool</div>
          <h1 style={{ margin: "8px 0 10px 0", fontSize: "32px", color: "#111" }}>
            Login
          </h1>
          <p style={{ color: "#5f6368", marginBottom: "25px" }}>
            Mit deiner Supabase-E-Mail und deinem Passwort anmelden.
          </p>

          <div style={{ marginBottom: "14px" }}>
            <label style={labelStyle}>E-Mail</label>
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="name@beispiel.de"
              style={inputStyle}
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
              style={inputStyle}
              autoComplete="current-password"
            />
          </div>

          <button onClick={handleLogin} style={primaryButtonStyle}>
            Einloggen
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={pageInnerStyle}>
        <div style={topBarStyle}>
          <div>
            <div style={eyebrowStyle}>Arbeitszeit Tool</div>
            <h1 style={{ margin: "6px 0 4px 0", color: "#111" }}>Shop Übersicht</h1>
            <p style={{ margin: 0, color: "#5f6368" }}>
              Eingeloggt als <strong>{authEmail || "-"}</strong> · Rolle{" "}
              <strong>{authRole || "-"}</strong>
            </p>
          </div>

          <div style={actionsWrapStyle}>
            <button
              onClick={clockedIn ? handleClockOut : handleClockIn}
              style={{
                ...primaryButtonStyle,
                background: clockedIn ? "#dc2626" : "#16a34a",
              }}
            >
              {clockedIn ? "Ausstempeln" : "Einstempeln"}
            </button>

            <button onClick={handleLogout} style={secondaryButtonStyle}>
              Abmelden
            </button>
          </div>
        </div>

        <div style={tabsBarStyle}>
          <TabButton
            active={activeTab === "dashboard"}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </TabButton>
          <TabButton
            active={activeTab === "wochenplan"}
            onClick={() => setActiveTab("wochenplan")}
          >
            Wochenplan
          </TabButton>
          <TabButton
            active={activeTab === "monatsuebersicht"}
            onClick={() => setActiveTab("monatsuebersicht")}
          >
            Monatsübersicht
          </TabButton>
          <TabButton
            active={activeTab === "stempelzeiten"}
            onClick={() => setActiveTab("stempelzeiten")}
          >
            Stempelzeiten
          </TabButton>
          <TabButton
            active={activeTab === "mitarbeiter"}
            onClick={() => setActiveTab("mitarbeiter")}
          >
            Mitarbeiter
          </TabButton>
        </div>

        {activeTab === "dashboard" ? renderDashboard() : null}
        {activeTab === "wochenplan" ? renderWochenplan() : null}
        {activeTab === "monatsuebersicht" ? renderMonatsuebersicht() : null}
        {activeTab === "stempelzeiten" ? renderStempelzeiten() : null}
        {activeTab === "mitarbeiter" ? renderMitarbeiter() : null}
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...tabButtonStyle,
        background: active ? "#2563eb" : "white",
        color: active ? "white" : "#111",
        borderColor: active ? "#2563eb" : "#d6dae1",
      }}
    >
      {children}
    </button>
  );
}

function QuickActionCard({
  title,
  text,
  button,
  onClick,
}: {
  title: string;
  text: string;
  button: string;
  onClick: () => void;
}) {
  return (
    <div style={quickActionCardStyle}>
      <h3 style={{ margin: "0 0 8px 0", color: "#111" }}>{title}</h3>
      <p style={{ margin: "0 0 16px 0", color: "#5f6368" }}>{text}</p>
      <button onClick={onClick} style={secondaryButtonStyle}>
        {button}
      </button>
    </div>
  );
}

function StatCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={statCardStyle}>
      <div style={{ color: "#6b7280", fontSize: "13px", marginBottom: "8px" }}>
        {title}
      </div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: "#111" }}>
        {children}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #eef4ff 0%, #f7f9fc 100%)",
  padding: "20px",
  fontFamily: "Arial, sans-serif",
  color: "#111",
};

const pageInnerStyle: CSSProperties = {
  maxWidth: "1600px",
  margin: "0 auto",
};

const topBarStyle: CSSProperties = {
  background: "white",
  borderRadius: "24px",
  padding: "24px",
  marginBottom: "18px",
  boxShadow: "0 12px 34px rgba(15,23,42,0.08)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "20px",
  flexWrap: "wrap",
};

const tabsBarStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginBottom: "20px",
};

const tabButtonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "999px",
  border: "1px solid #d6dae1",
  background: "white",
  cursor: "pointer",
  fontWeight: "bold",
  boxShadow: "0 4px 12px rgba(15,23,42,0.05)",
};

const sectionStyle: CSSProperties = {
  background: "white",
  borderRadius: "24px",
  padding: "22px",
  boxShadow: "0 12px 34px rgba(15,23,42,0.08)",
  marginBottom: "20px",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  flexWrap: "wrap",
  marginBottom: "16px",
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "24px",
  color: "#111",
};

const sectionTextStyle: CSSProperties = {
  margin: "6px 0 0 0",
  color: "#5f6368",
};

const heroCardStyle: CSSProperties = {
  background: "linear-gradient(135deg, #dbeafe 0%, #ffffff 70%)",
  borderRadius: "24px",
  padding: "28px",
  boxShadow: "0 12px 34px rgba(15,23,42,0.08)",
  marginBottom: "20px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "20px",
  flexWrap: "wrap",
};

const warningCardStyle: CSSProperties = {
  background: "#fff7ed",
  border: "1px solid #fdba74",
  color: "#9a3412",
  borderRadius: "18px",
  padding: "16px 18px",
  marginBottom: "20px",
};

const eyebrowStyle: CSSProperties = {
  color: "#2563eb",
  fontWeight: "bold",
  fontSize: "13px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "15px",
  marginBottom: "20px",
};

const statCardStyle: CSSProperties = {
  background: "white",
  borderRadius: "22px",
  padding: "20px",
  boxShadow: "0 12px 34px rgba(15,23,42,0.08)",
};

const dashboardActionsGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "16px",
};

const quickActionCardStyle: CSSProperties = {
  background: "white",
  borderRadius: "22px",
  padding: "20px",
  boxShadow: "0 12px 34px rgba(15,23,42,0.08)",
};

const filtersGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
};

const actionsWrapStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: "8px",
  fontWeight: "bold",
  color: "#111",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: "14px",
  border: "1px solid #d6dae1",
  fontSize: "16px",
  background: "#fff",
  color: "#111",
};

const smallInputStyle: CSSProperties = {
  width: "100%",
  padding: "6px",
  borderRadius: "10px",
  border: "1px solid #d6dae1",
  fontSize: "12px",
  background: "#fff",
  color: "#111",
  marginBottom: "6px",
};

const primaryButtonStyle: CSSProperties = {
  padding: "11px 16px",
  borderRadius: "12px",
  border: "none",
  background: "#2563eb",
  color: "white",
  fontWeight: "bold",
  cursor: "pointer",
  boxShadow: "0 8px 20px rgba(37,99,235,0.25)",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "11px 16px",
  borderRadius: "12px",
  border: "1px solid #d6dae1",
  background: "white",
  color: "#111",
  cursor: "pointer",
};

const dangerButtonStyle: CSSProperties = {
  padding: "11px 16px",
  borderRadius: "12px",
  border: "none",
  background: "#dc2626",
  color: "white",
  cursor: "pointer",
  fontWeight: "bold",
};

const thStyle: CSSProperties = {
  textAlign: "center",
  padding: "12px",
  border: "1px solid #d6dae1",
  color: "#111",
  fontWeight: "bold",
  background: "#f3f4f6",
};

const nameCellStyle: CSSProperties = {
  padding: "12px",
  border: "1px solid #d6dae1",
  fontWeight: "bold",
  background: "#fff",
  minWidth: "140px",
};

const tableCellStyle: CSSProperties = {
  padding: "8px",
  border: "1px solid #d6dae1",
  textAlign: "center",
  verticalAlign: "middle",
};

const editCellStyle: CSSProperties = {
  padding: "8px",
  border: "1px solid #d6dae1",
  verticalAlign: "top",
  minWidth: "180px",
  background: "#fff",
};

const hoursCellStyle: CSSProperties = {
  padding: "12px",
  border: "1px solid #d6dae1",
  textAlign: "center",
  fontWeight: "bold",
  background: "#f9fafb",
  minWidth: "90px",
};

const loadingPageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  background: "linear-gradient(180deg, #eef4ff 0%, #f7f9fc 100%)",
  fontFamily: "Arial, sans-serif",
};

const loadingCardStyle: CSSProperties = {
  background: "white",
  padding: "24px 30px",
  borderRadius: "20px",
  boxShadow: "0 12px 34px rgba(15,23,42,0.08)",
};

const loginPageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(180deg, #eef4ff 0%, #f7f9fc 100%)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "20px",
  fontFamily: "Arial, sans-serif",
  color: "#111",
};

const loginCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: "460px",
  background: "white",
  borderRadius: "28px",
  padding: "34px",
  boxShadow: "0 18px 44px rgba(15,23,42,0.12)",
};

const statusBadgeBlue: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#dbeafe",
  color: "#1d4ed8",
  fontWeight: "bold",
  fontSize: "12px",
};

const statusBadgeGray: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#e5e7eb",
  color: "#374151",
  fontWeight: "bold",
  fontSize: "12px",
};

const statusBadgeGreen: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#dcfce7",
  color: "#15803d",
  fontWeight: "bold",
  fontSize: "12px",
};

const statusBadgeOrange: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#ffedd5",
  color: "#c2410c",
  fontWeight: "bold",
  fontSize: "12px",
};

const statusBadgeYellow: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#fef3c7",
  color: "#a16207",
  fontWeight: "bold",
  fontSize: "12px",
};

const statusBadgeRed: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: "999px",
  background: "#fee2e2",
  color: "#b91c1c",
  fontWeight: "bold",
  fontSize: "12px",
};

const summaryMiniBoxStyle: CSSProperties = {
  background: "#ffffff",
  border: "1px solid #dbe2ea",
  borderRadius: "16px",
  padding: "10px 14px",
  minWidth: "100px",
  boxShadow: "0 4px 10px rgba(15,23,42,0.04)",
};

const summaryMiniLabelStyle: CSSProperties = {
  fontSize: "11px",
  color: "#6b7280",
  marginBottom: "4px",
  textTransform: "uppercase",
  fontWeight: "bold",
};

const summaryMiniValueStyle: CSSProperties = {
  fontSize: "18px",
  fontWeight: "bold",
  color: "#111",
};