/* ============================================================
   SOS HGS GANDAKI — CORE ENGINE
   Shared by login.html, student.html, teacher.html, admin.html
   Storage: localStorage (offline-first) with Firebase sync hook
   ============================================================ */

const SOS = (() => {
  "use strict";

  /* ---------- CONSTANTS ---------- */
  const DEFAULT_PASS = {
    admin: "SOSHGS,admin",
    student: "SOSHGS,student",
    teacher: "SOSHGS,teacher"
  };

  const DB_KEYS = {
    students: "sos_students",
    teachers: "sos_teachers",
    admins: "sos_admins",
    attendance: "sos_attendance",
    notices: "sos_notices",
    assignments: "sos_assignments",
    calendar: "sos_calendar",
    routine: "sos_routine",
    substitutes: "sos_substitutes",
    schoolNotifications: "sos_school_notifications", // admin activity log
    messages: "sos_messages", // teacher<->admin, student<->classteacher, teacher->parent
    session: "sos_session",
    aiSettings: "sos_ai_settings",
    userNotifs: "sos_user_notifications" // per-user bell notifications
  };

  /* ---------- UTIL ---------- */
  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowNepal() {
    // Nepal Standard Time = UTC+5:45
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const npt = new Date(utcMs + (5 * 60 + 45) * 60000);
    return npt;
  }

  function formatNepaliDateTime(d) {
    const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${h}:${mm} ${ampm} NPT`;
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
  }

  /* ---------- STORAGE (offline-first, Firebase-ready hook) ---------- */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : (fallback ?? []);
    } catch (e) { return fallback ?? []; }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    // Firebase sync hook: if firebase is configured & online, mirror the write.
    if (navigator.onLine && window.SOS_FIREBASE && window.SOS_FIREBASE.enabled) {
      try { window.SOS_FIREBASE.sync(key, value); } catch (e) { /* silent offline fallback */ }
    }
    return value;
  }

  /* ---------- SEED (creates default admin only — no demo students/teachers) ---------- */
  function ensureSeed() {
    const admins = read(DB_KEYS.admins, null);
    if (!admins) {
      write(DB_KEYS.admins, [{
        id: uid("adm"),
        name: "admin",
        loginId: "admin",
        password: DEFAULT_PASS.admin,
        createdAt: nowNepal().toISOString()
      }]);
    }
    [DB_KEYS.students, DB_KEYS.teachers, DB_KEYS.attendance, DB_KEYS.notices,
     DB_KEYS.assignments, DB_KEYS.calendar, DB_KEYS.routine, DB_KEYS.substitutes,
     DB_KEYS.schoolNotifications, DB_KEYS.messages, DB_KEYS.userNotifs].forEach(k => {
      if (read(k, null) === null) write(k, []);
    });
    if (read(DB_KEYS.aiSettings, null) === null) {
      write(DB_KEYS.aiSettings, { provider: "none", apiKey: "" });
    }
  }

  /* ---------- NOTIFICATIONS (bell / notification bar) ---------- */
  function pushNotification(targetLoginId, targetRole, title, body) {
    const list = read(DB_KEYS.userNotifs, []);
    list.unshift({
      id: uid("ntf"),
      targetLoginId, targetRole,
      title, body,
      time: nowNepal().toISOString(),
      read: false
    });
    write(DB_KEYS.userNotifs, list.slice(0, 300));
    // Native browser notification if permitted
    if (window.Notification && Notification.permission === "granted") {
      try { new Notification(title, { body }); } catch (e) {}
    }
  }
  function getNotifications(loginId) {
    return read(DB_KEYS.userNotifs, []).filter(n => n.targetLoginId === loginId || n.targetRole === "all");
  }
  function markAllRead(loginId) {
    const list = read(DB_KEYS.userNotifs, []);
    list.forEach(n => { if (n.targetLoginId === loginId) n.read = true; });
    write(DB_KEYS.userNotifs, list);
  }
  function requestNotifPermission() {
    if (window.Notification && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  /* ---------- SCHOOL MANAGEMENT LOG (admin activity feed) ---------- */
  function logSchoolActivity(text, meta) {
    const list = read(DB_KEYS.schoolNotifications, []);
    list.unshift({ id: uid("log"), text, meta: meta || {}, time: nowNepal().toISOString() });
    write(DB_KEYS.schoolNotifications, list.slice(0, 500));
  }

  /* ---------- AUTH ---------- */
  function findUser(role, loginId) {
    const key = role === "admin" ? DB_KEYS.admins : role === "teacher" ? DB_KEYS.teachers : DB_KEYS.students;
    const list = read(key, []);
    return list.find(u => u.loginId.toLowerCase() === loginId.toLowerCase());
  }

  function login(role, loginId, password) {
    const user = findUser(role, loginId);
    if (!user) return { ok: false, error: "No account found with that name. Please sign up first." };
    if (user.password !== password) return { ok: false, error: "Incorrect password." };
    if (user.disabled) return { ok: false, error: "This account has been disabled by admin." };
    const session = { role, loginId: user.loginId, id: user.id, name: user.name, loginTime: nowNepal().toISOString() };
    write(DB_KEYS.session, session);
    return { ok: true, user };
  }

  function logout() {
    localStorage.removeItem(DB_KEYS.session);
  }

  function getSession() {
    return read(DB_KEYS.session, null);
  }

  function requireSession(role) {
    const s = getSession();
    if (!s || s.role !== role) {
      window.location.href = "login.html";
      return null;
    }
    return s;
  }

  /* ---------- SIGN UP ---------- */
  function signUpStudent({ name, className, rollNo, barcode }) {
    if (!name || !className || !rollNo || !barcode) {
      return { ok: false, error: "All fields are required, including ID card barcode." };
    }
    const students = read(DB_KEYS.students, []);
    if (students.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "An account with this name already exists. Use a different name (e.g. add middle name) or login instead." };
    }
    if (students.some(s => s.barcode === barcode)) {
      return { ok: false, error: "This ID card barcode is already registered to another account." };
    }
    const rec = {
      id: uid("stu"),
      loginId: name.trim(),
      name: name.trim(),
      className: className.trim(),
      rollNo: rollNo.trim(),
      barcode: barcode.trim(),
      password: DEFAULT_PASS.student,
      createdAt: nowNepal().toISOString(),
      disabled: false
    };
    students.push(rec);
    write(DB_KEYS.students, students);
    logSchoolActivity(`New student account created — Student: ${rec.name} | Class: ${rec.className} | Roll No: ${rec.rollNo} | Barcode: ${rec.barcode}`, { type: "student_signup", id: rec.id });
    pushNotification("admin", "admin", "New Student Signup", `${rec.name} (Class ${rec.className}, Roll ${rec.rollNo}) created a login at ${formatNepaliDateTime(nowNepal())}`);
    return { ok: true, user: rec };
  }

  function signUpTeacher({ name, classTeacherOf, subject }) {
    if (!name || !subject) {
      return { ok: false, error: "Name and subject are required." };
    }
    const teachers = read(DB_KEYS.teachers, []);
    if (teachers.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "An account with this name already exists." };
    }
    const rec = {
      id: uid("tch"),
      loginId: name.trim(),
      name: name.trim(),
      classTeacherOf: (classTeacherOf || "").trim(), // "" = not a class teacher
      subject: subject.trim(),
      password: DEFAULT_PASS.teacher,
      createdAt: nowNepal().toISOString(),
      disabled: false
    };
    teachers.push(rec);
    write(DB_KEYS.teachers, teachers);
    logSchoolActivity(`New teacher account created — Teacher: ${rec.name} | Subject: ${rec.subject}${rec.classTeacherOf ? " | Class Teacher of: " + rec.classTeacherOf : ""}`, { type: "teacher_signup", id: rec.id });
    pushNotification("admin", "admin", "New Teacher Signup", `${rec.name} (${rec.subject}) created a login at ${formatNepaliDateTime(nowNepal())}`);
    return { ok: true, user: rec };
  }

  /* ---------- ADMIN: MANAGE USERS ---------- */
  function resetAllPasswords() {
    const students = read(DB_KEYS.students, []).map(s => ({ ...s, password: DEFAULT_PASS.student }));
    const teachers = read(DB_KEYS.teachers, []).map(t => ({ ...t, password: DEFAULT_PASS.teacher }));
    write(DB_KEYS.students, students);
    write(DB_KEYS.teachers, teachers);
    logSchoolActivity("Admin reset all student & teacher passwords to default.");
  }
  function removeStudent(studentId) {
    const students = read(DB_KEYS.students, []);
    const target = students.find(s => s.id === studentId);
    const filtered = students.filter(s => s.id !== studentId);
    write(DB_KEYS.students, filtered);
    if (target) logSchoolActivity(`Admin removed student account: ${target.name} (Class ${target.className}, Roll ${target.rollNo})`);
  }
  function removeTeacher(teacherId) {
    const teachers = read(DB_KEYS.teachers, []);
    const target = teachers.find(t => t.id === teacherId);
    const filtered = teachers.filter(t => t.id !== teacherId);
    write(DB_KEYS.teachers, filtered);
    if (target) logSchoolActivity(`Admin removed teacher account: ${target.name} (${target.subject})`);
  }
  function toggleDisableStudent(studentId, disabled) {
    const students = read(DB_KEYS.students, []);
    const s = students.find(x => x.id === studentId);
    if (s) { s.disabled = disabled; write(DB_KEYS.students, students); }
  }

  /* ---------- ATTENDANCE (via barcode scan) ---------- */
  function markAttendanceByBarcode(scannedCode) {
    const students = read(DB_KEYS.students, []);
    const student = students.find(s => s.barcode === scannedCode);
    if (!student) return { ok: false, error: "Barcode not recognized. Ensure your ID card is registered." };
    const today = dateKey(nowNepal());
    const attendance = read(DB_KEYS.attendance, []);
    const already = attendance.find(a => a.studentId === student.id && a.date === today);
    if (already) return { ok: false, error: `Attendance already marked today at ${new Date(already.time).toLocaleTimeString()}.`, student };
    const rec = {
      id: uid("att"),
      studentId: student.id,
      studentName: student.name,
      className: student.className,
      rollNo: student.rollNo,
      date: today,
      status: "present",
      time: nowNepal().toISOString(),
      markedBy: "self-barcode"
    };
    attendance.push(rec);
    write(DB_KEYS.attendance, attendance);
    return { ok: true, student, record: rec };
  }

  function getAttendanceForStudent(studentId) {
    return read(DB_KEYS.attendance, []).filter(a => a.studentId === studentId);
  }

  function getAttendanceForClass(className, date) {
    return read(DB_KEYS.attendance, []).filter(a => a.className === className && a.date === date);
  }

  // Teacher (class teacher only) can remove/correct an attendance record for their class
  function removeAttendanceRecord(recordId, byTeacher) {
    const attendance = read(DB_KEYS.attendance, []);
    const rec = attendance.find(a => a.id === recordId);
    if (!rec) return { ok: false, error: "Record not found." };
    if (byTeacher && byTeacher.classTeacherOf !== rec.className) {
      return { ok: false, error: "You can only manage attendance for your own class." };
    }
    write(DB_KEYS.attendance, attendance.filter(a => a.id !== recordId));
    logSchoolActivity(`Attendance record removed for ${rec.studentName} (${rec.date}) by ${byTeacher ? byTeacher.name : "admin"}.`);
    return { ok: true };
  }

  // Build a month map: { "1": "present"|"absent"|null, ... } based on school days that have passed
  function buildMonthAttendance(studentId, year, month) {
    const records = getAttendanceForStudent(studentId);
    const map = {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = nowNepal();
    const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
    const lastDay = isCurrentMonth ? today.getDate() : (year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth()) ? daysInMonth : 0);
    for (let d = 1; d <= daysInMonth; d++) {
      const dk = `${year}-${(month+1).toString().padStart(2,"0")}-${d.toString().padStart(2,"0")}`;
      const found = records.find(r => r.date === dk);
      if (found) map[d] = "present";
      else if (d <= lastDay) map[d] = "absent";
      else map[d] = null; // future day, not yet determined
    }
    return map;
  }

  /* ---------- NOTICES (event name, venue, description) ---------- */
  function sendNotice({ from, fromRole, title, venue, description, audience, className }) {
    // audience: "students" | "teachers" | "both"
    // className: required if fromRole === teacher (their own class only) OR admin targeting one class ("" = all classes)
    const notices = read(DB_KEYS.notices, []);
    const rec = {
      id: uid("not"),
      from, fromRole, title, venue: venue || "", description: description || "",
      audience, className: className || "",
      time: nowNepal().toISOString()
    };
    notices.unshift(rec);
    write(DB_KEYS.notices, notices);
    const label = `${title}${venue ? " @ " + venue : ""}`;
    if (audience === "students" || audience === "both") {
      pushNotification("students", "student", "New Notice", label);
    }
    if (audience === "teachers" || audience === "both") {
      pushNotification("teachers", "teacher", "New Notice", label);
    }
    logSchoolActivity(`Notice sent by ${fromRole} ${from}: "${title}" → ${audience}${className ? " (Class " + className : ""}`);
    return rec;
  }

  function getNoticesFor(role, className) {
    return read(DB_KEYS.notices, []).filter(n => {
      const audienceMatch = n.audience === "both" || n.audience === (role === "student" ? "students" : "teachers");
      const classMatch = !n.className || n.className === className;
      return audienceMatch && classMatch;
    });
  }

  /* ---------- ASSIGNMENTS ---------- */
  function createAssignment({ from, subject, className, title, description, dueDate }) {
    const list = read(DB_KEYS.assignments, []);
    const rec = { id: uid("asg"), from, subject, className, title, description, dueDate, time: nowNepal().toISOString() };
    list.unshift(rec);
    write(DB_KEYS.assignments, list);
    pushNotification("students", "student", "New Assignment", `${subject}: ${title} (due ${dueDate})`);
    logSchoolActivity(`Assignment posted by ${from} for Class ${className}: "${title}"`);
    return rec;
  }
  function getAssignmentsForClass(className) {
    return read(DB_KEYS.assignments, []).filter(a => a.className === className);
  }

  /* ---------- CALENDAR & ROUTINE (admin uploads) ---------- */
  function setCalendarEvent({ date, label, type }) {
    const list = read(DB_KEYS.calendar, []);
    list.push({ id: uid("cal"), date, label, type: type || "event" });
    write(DB_KEYS.calendar, list);
    logSchoolActivity(`Admin added calendar entry: ${label} (${date})`);
  }
  function getCalendar() { return read(DB_KEYS.calendar, []); }

  function setRoutine({ className, day, periods }) {
    // periods: [{time, subject, teacher}]
    const list = read(DB_KEYS.routine, []);
    const idx = list.findIndex(r => r.className === className && r.day === day);
    const rec = { className, day, periods, updatedAt: nowNepal().toISOString() };
    if (idx >= 0) list[idx] = rec; else list.push(rec);
    write(DB_KEYS.routine, list);
    logSchoolActivity(`Admin updated routine for Class ${className}, ${day}`);
  }
  function getRoutineForClass(className) {
    return read(DB_KEYS.routine, []).filter(r => r.className === className);
  }

  /* ---------- SUBSTITUTES ---------- */
  function createSubstitute({ absentTeacher, className, subject, substituteTeacher, date, period }) {
    const list = read(DB_KEYS.substitutes, []);
    const rec = { id: uid("sub"), absentTeacher, className, subject, substituteTeacher, date, period, time: nowNepal().toISOString() };
    list.unshift(rec);
    write(DB_KEYS.substitutes, list);
    pushNotification(substituteTeacher, "teacher", "Substitute Assignment", `Cover ${subject} for Class ${className} on ${date}, Period ${period} (${absentTeacher} is absent)`);
    pushNotification("students", "student", "Substitute Notice", `${subject} on ${date} (Period ${period}) will be covered by ${substituteTeacher}`);
    logSchoolActivity(`Admin assigned substitute: ${substituteTeacher} covers ${subject} for Class ${className} on ${date} (${absentTeacher} absent)`);
    return rec;
  }
  function getSubstitutesForTeacher(name) {
    return read(DB_KEYS.substitutes, []).filter(s => s.substituteTeacher === name);
  }
  function getSubstitutesForClass(className) {
    return read(DB_KEYS.substitutes, []).filter(s => s.className === className);
  }

  /* ---------- MESSAGES (teacher<->admin absence note, student->class teacher, teacher->parent) ---------- */
  function sendMessage({ from, fromRole, to, toRole, subject, body }) {
    const list = read(DB_KEYS.messages, []);
    const rec = { id: uid("msg"), from, fromRole, to, toRole, subject: subject || "", body, time: nowNepal().toISOString(), read: false };
    list.unshift(rec);
    write(DB_KEYS.messages, list);
    pushNotification(to, toRole, `Message from ${from}`, subject || body.slice(0, 60));
    return rec;
  }
  function getMessagesFor(name) {
    return read(DB_KEYS.messages, []).filter(m => m.to === name || m.from === name);
  }

  /* ---------- AI SETTINGS ---------- */
  function getAISettings() { return read(DB_KEYS.aiSettings, { provider: "none", apiKey: "" }); }
  function setAISettings(settings) { write(DB_KEYS.aiSettings, settings); }

  async function askAI(prompt, context) {
    const settings = getAISettings();
    if (!navigator.onLine || settings.provider === "none" || !settings.apiKey) {
      return offlineAI(prompt, context);
    }
    try {
      if (settings.provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${settings.apiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: buildAIPrompt(prompt, context) }] }] })
        });
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || "AI did not return a response.";
      }
      if (settings.provider === "groq") {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: buildAIPrompt(prompt, context) }] })
        });
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || "AI did not return a response.";
      }
      if (settings.provider === "openrouter") {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: buildAIPrompt(prompt, context) }] })
        });
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || "AI did not return a response.";
      }
      return offlineAI(prompt, context);
    } catch (e) {
      return offlineAI(prompt, context) + "\n\n(Note: online AI request failed, showing offline summary instead.)";
    }
  }

  function buildAIPrompt(prompt, context) {
    let ctx = "You are the SOS HGS Gandaki school assistant. Be concise and helpful.\n";
    if (context?.attendance) ctx += `Student attendance record: ${JSON.stringify(context.attendance)}.\n`;
    if (context?.assignments) ctx += `Assignments: ${JSON.stringify(context.assignments)}.\n`;
    return ctx + "\nQuestion: " + prompt;
  }

  function offlineAI(prompt, context) {
    // Rule-based offline fallback — no network required
    const p = prompt.toLowerCase();
    if (context?.attendance) {
      const total = context.attendance.total || 0;
      const present = context.attendance.present || 0;
      const pct = total ? Math.round((present / total) * 100) : 0;
      if (p.includes("attend")) {
        return `Offline mode: You have been present ${present} out of ${total} school days (${pct}%). Connect to the internet for a detailed AI summary.`;
      }
    }
    if (p.includes("assignment") || p.includes("homework")) {
      const due = context?.assignments?.[0];
      return due
        ? `Offline mode: Your next assignment is "${due.title}" for ${due.subject}, due ${due.dueDate}. Connect to the internet for AI help writing it.`
        : "Offline mode: No pending assignments found in your saved data.";
    }
    return "You're offline. AI chat needs internet — showing saved data only. Ask about your attendance or assignments for a quick offline summary.";
  }

  /* ---------- PUBLIC API ---------- */
  return {
    KEYS: DB_KEYS, DEFAULT_PASS,
    uid, nowNepal, formatNepaliDateTime, dateKey,
    read, write, ensureSeed,
    pushNotification, getNotifications, markAllRead, requestNotifPermission,
    logSchoolActivity,
    login, logout, getSession, requireSession, findUser,
    signUpStudent, signUpTeacher,
    resetAllPasswords, removeStudent, removeTeacher, toggleDisableStudent,
    markAttendanceByBarcode, getAttendanceForStudent, getAttendanceForClass, removeAttendanceRecord, buildMonthAttendance,
    sendNotice, getNoticesFor,
    createAssignment, getAssignmentsForClass,
    setCalendarEvent, getCalendar, setRoutine, getRoutineForClass,
    createSubstitute, getSubstitutesForTeacher, getSubstitutesForClass,
    sendMessage, getMessagesFor,
    getAISettings, setAISettings, askAI
  };
})();

document.addEventListener("DOMContentLoaded", () => SOS.ensureSeed());
