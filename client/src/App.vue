<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "./api";

const view = ref("list"); // list | management | configuration | detail | new
const loading = ref(false);
const error = ref("");

const MONTHLY_CAPACITY = 160;
const WORK_DAYS_PER_MONTH = 20;
const HOURS_PER_DAY = MONTHLY_CAPACITY / WORK_DAYS_PER_MONTH;
const PEOPLE_SETTINGS_STORAGE_KEY = "opportunities.peopleDailyHours.v1";
const people = ref([
  "Anna Wacholak",
  "Jacek Szostak",
  "Grzegorz Nowakowski",
  "Krzysztof Bukowski",
  "Daniel Troska"
]);
const personDailyHours = ref({});
const newPersonName = ref("");
const newPersonDailyHours = ref(8);

const q = ref("");
const sort = ref("updated");
const dir = ref("desc");
const stageFilter = ref("");
const statusFilter = ref("");

const opportunities = ref([]);
const selected = ref(null);
const assignments = ref([]);
const timelineUnitsToShow = ref(6);
const timelinePerspective = ref("months");
const timelineStageFilter = ref("");
const upcomingPeriod = ref("this-week");

const assignmentDraft = ref({
  personName: "",
  plannedStartDate: "",
  plannedEndDate: "",
  allocatedHours: "",
  allocationPercent: 50,
});
const assignmentEdits = ref({});
const resizeState = ref(null);
const resizePreviewById = ref({});
const suppressTimelineOpenUntil = ref(0);
const timelineAssignmentDraft = ref({
  personName: "",
  opportunityId: "",
  plannedStartDate: new Date().toISOString().slice(0, 10),
  plannedEndDate: "",
  allocatedHours: "",
  allocationPercent: 50,
});
const allocationModal = ref({
  open: false,
  target: "", // detail-create | timeline-create | timeline-edit
  assignmentId: "",
});
const allocationMode = ref("percent"); // percent | total-hours | monthly-hours
const allocationInput = ref({
  percent: 50,
  totalHours: "",
  monthlyHours: "",
});

const emptyForm = () => ({
  name: "",
  technologyStack: "",
  description: "",
  assignedPerson: "",
  businessOwner: "",
  firstContactDate: "",
  stage: "New",
  status: "Open",
  priority: 3,
  tags: "",
  nextStepSummary: "",
  nextStepDueDate: "",
  opportunityHours: "",
  opportunityTimeline: "",
  plannedStartDate: "",
  plannedEndDate: "",
  allocationPercent: 100
});

const form = ref(emptyForm());

function initAssignmentEdits(items) {
  const next = {};
  for (const assignment of items || []) {
    next[assignment.Id] = {
      personName: assignment.PersonName || "",
      plannedStartDate: assignment.PlannedStartDate?.slice(0, 10) || "",
      plannedEndDate: assignment.PlannedEndDate?.slice(0, 10) || "",
      allocatedHours: Number(assignment.AllocatedHours || 0),
      allocationPercent: Number(assignment.AllocationPercent || 0),
      isTimelineVisible: !!assignment.IsTimelineVisible,
    };
  }
  assignmentEdits.value = next;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getPersonDailyHours(personName) {
  const configured = Number(personDailyHours.value[personName]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return HOURS_PER_DAY;
}

function savePeopleSettings() {
  localStorage.setItem(PEOPLE_SETTINGS_STORAGE_KEY, JSON.stringify({
    people: people.value,
    personDailyHours: personDailyHours.value,
  }));
}

function loadPeopleSettings() {
  try {
    const raw = localStorage.getItem(PEOPLE_SETTINGS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.people) && parsed.people.length) {
      people.value = [...new Set(parsed.people.map((x) => String(x).trim()).filter(Boolean))];
    }
    if (parsed.personDailyHours && typeof parsed.personDailyHours === "object") {
      personDailyHours.value = parsed.personDailyHours;
    }
  } catch {
    // keep defaults if local settings are invalid
  }
}

function updatePersonDailyHours(personName, value) {
  const next = Number(value);
  if (!Number.isFinite(next) || next <= 0) return;
  personDailyHours.value = {
    ...personDailyHours.value,
    [personName]: next,
  };
  savePeopleSettings();
}

function addPerson() {
  const name = newPersonName.value.trim();
  const dailyHours = Number(newPersonDailyHours.value);
  if (!name || !Number.isFinite(dailyHours) || dailyHours <= 0) return;
  if (!people.value.includes(name)) {
    people.value = [...people.value, name];
  }
  updatePersonDailyHours(name, dailyHours);
  newPersonName.value = "";
  newPersonDailyHours.value = 8;
}

function calculateAllocationPercentFromHours(assignedHours, totalHours) {
  const assigned = Number(assignedHours || 0);
  const total = Number(totalHours || 0);
  if (assigned <= 0 || total <= 0) return null;
  return round2((assigned / total) * 100);
}

function calculateAssignedHoursFromPercent(allocationPercent, totalHours) {
  const percent = Number(allocationPercent || 0);
  const total = Number(totalHours || 0);
  if (percent <= 0 || total <= 0) return null;
  return round2(total * (percent / 100));
}

function countBusinessDaysInclusiveText(startDateText, endDateText) {
  const start = toDate(startDateText);
  const end = toDate(endDateText);
  if (!start || !end || end < start) return 0;
  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return countBusinessDays(start, endExclusive);
}

function countMonthsInclusiveText(startDateText, endDateText) {
  const start = toDate(startDateText);
  const end = toDate(endDateText);
  if (!start || !end || end < start) return 0;
  let months = (end.getFullYear() - start.getFullYear()) * 12;
  months += end.getMonth() - start.getMonth();
  return months + 1;
}

const assignmentById = computed(() => {
  const map = new Map();
  for (const item of assignmentRows.value) {
    map.set(item.Id, item);
  }
  return map;
});

function allocationContext() {
  const target = allocationModal.value.target;
  if (target === "timeline-create") {
    const opportunity = opportunities.value.find((item) => item.Id === timelineAssignmentDraft.value.opportunityId);
    return {
      personName: timelineAssignmentDraft.value.personName,
      startDate: timelineAssignmentDraft.value.plannedStartDate,
      endDate: timelineAssignmentDraft.value.plannedEndDate,
      opportunityHours: Number(opportunity?.OpportunityHours || 0),
      currentPercent: Number(timelineAssignmentDraft.value.allocationPercent || 0),
    };
  }
  if (target === "timeline-edit") {
    const assignment = assignmentById.value.get(allocationModal.value.assignmentId);
    return {
      personName: assignment?.PersonName || "",
      startDate: assignment?.PlannedStartDate?.slice(0, 10) || "",
      endDate: assignment?.PlannedEndDate?.slice(0, 10) || "",
      opportunityHours: Number(assignment?.OpportunityHours || 0),
      currentPercent: Number(assignment?.AllocationPercent || 0),
    };
  }
  return {
    personName: assignmentDraft.value.personName,
    startDate: assignmentDraft.value.plannedStartDate,
    endDate: assignmentDraft.value.plannedEndDate,
    opportunityHours: Number(form.value.opportunityHours || 0),
    currentPercent: Number(assignmentDraft.value.allocationPercent || 0),
  };
}

function openAllocationModal(target, assignmentId = "") {
  allocationModal.value = { open: true, target, assignmentId };
  allocationMode.value = "percent";
  const context = allocationContext();
  allocationInput.value.percent = context.currentPercent || 50;
  allocationInput.value.totalHours = "";
  allocationInput.value.monthlyHours = "";
}

function closeAllocationModal() {
  allocationModal.value = { open: false, target: "", assignmentId: "" };
}

function syncTimelineDraftFromProject() {
  const opportunity = opportunities.value.find((item) => item.Id === timelineAssignmentDraft.value.opportunityId);
  timelineAssignmentDraft.value.allocatedHours = calculateAssignedHoursFromPercent(
    timelineAssignmentDraft.value.allocationPercent,
    opportunity?.OpportunityHours
  ) || "";
  if (!timelineAssignmentDraft.value.plannedEndDate) {
    timelineAssignmentDraft.value.plannedEndDate = timelineAssignmentDraft.value.plannedStartDate;
  }
}

const allocationModalPreview = computed(() => {
  const context = allocationContext();
  const startDate = context.startDate;
  const endDate = context.endDate;
  const opportunityHours = context.opportunityHours;
  const dailyHoursForPerson = getPersonDailyHours(context.personName);

  const businessDays = countBusinessDaysInclusiveText(startDate, endDate);
  const capacityHours = businessDays * dailyHoursForPerson;

  if (allocationMode.value === "percent") {
    const percent = Number(allocationInput.value.percent || 0);
    const hours = calculateAssignedHoursFromPercent(percent, opportunityHours) || 0;
    return { percent: round2(percent), hours: round2(hours), businessDays, capacityHours, months: 0 };
  }

  if (allocationMode.value === "total-hours") {
    const hours = Number(allocationInput.value.totalHours || 0);
    const percent = calculateAllocationPercentFromHours(hours, capacityHours) || 0;
    return { percent: round2(percent), hours: round2(hours), businessDays, capacityHours, months: 0 };
  }

  const monthlyHours = Number(allocationInput.value.monthlyHours || 0);
  const months = countMonthsInclusiveText(startDate, endDate);
  const hours = round2(monthlyHours * months);
  const percent = calculateAllocationPercentFromHours(hours, capacityHours) || 0;
  return { percent: round2(percent), hours: round2(hours), businessDays, capacityHours, months };
});

async function applyAllocationModal() {
  const preview = allocationModalPreview.value;
  if (preview.hours <= 0 || preview.percent <= 0) {
    error.value = "Allocation values must be greater than 0.";
    return;
  }
  if (preview.percent > 100) {
    error.value = "Calculated allocation percent is above 100%. Adjust hours or period.";
    return;
  }

  if (allocationModal.value.target === "timeline-create") {
    timelineAssignmentDraft.value.allocatedHours = preview.hours;
    timelineAssignmentDraft.value.allocationPercent = preview.percent;
    closeAllocationModal();
    await addAssignmentFromTimeline();
    return;
  }

  if (allocationModal.value.target === "timeline-edit") {
    const assignment = assignmentById.value.get(allocationModal.value.assignmentId);
    if (!assignment) {
      error.value = "Selected assignment is no longer available.";
      return;
    }
    loading.value = true;
    error.value = "";
    try {
      await api.updateAssignment(assignment.Id, {
        allocatedHours: preview.hours,
        allocationPercent: preview.percent,
      });
      await refreshList();
      if (selected.value) {
        await openDetail(selected.value.opportunity.Id);
      }
    } catch (e) {
      error.value = e.message;
      return;
    } finally {
      loading.value = false;
    }
  } else {
    assignmentDraft.value.allocatedHours = preview.hours;
    assignmentDraft.value.allocationPercent = preview.percent;
    closeAllocationModal();
    await addAssignment();
    return;
  }
  closeAllocationModal();
}

function toggleTimelineStageFilter(stageKey) {
  timelineStageFilter.value = timelineStageFilter.value === stageKey ? "" : stageKey;
}

function syncAssignmentEditFromPercent(assignmentId, opportunityHours) {
  const edit = assignmentEdits.value[assignmentId];
  if (!edit) return;
  const nextHours = calculateAssignedHoursFromPercent(edit.allocationPercent, opportunityHours);
  if (nextHours !== null) edit.allocatedHours = nextHours;
}

function assignmentDraftCalculatedHours() {
  const explicit = Number(assignmentDraft.value.allocatedHours || 0);
  if (explicit > 0) return round2(explicit);
  return calculateAssignedHoursFromPercent(assignmentDraft.value.allocationPercent, form.value.opportunityHours) ?? 0;
}

function timelineDraftCalculatedHours() {
  const explicit = Number(timelineAssignmentDraft.value.allocatedHours || 0);
  if (explicit > 0) return round2(explicit);
  const opportunity = opportunities.value.find((item) => item.Id === timelineAssignmentDraft.value.opportunityId);
  return calculateAssignedHoursFromPercent(timelineAssignmentDraft.value.allocationPercent, opportunity?.OpportunityHours) ?? 0;
}

function assignmentEditCalculatedHours(assignmentId) {
  const edit = assignmentEdits.value[assignmentId];
  if (!edit) return 0;
  return calculateAssignedHoursFromPercent(edit.allocationPercent, form.value.opportunityHours) ?? 0;
}

function normalizePayload(v) {
  return {
    name: v.name,
    technologyStack: v.technologyStack || null,
    description: v.description || null,
    techOwner: v.assignedPerson || null,
    businessOwner: v.businessOwner || null,
    firstContactDate: v.firstContactDate || null,
    stage: v.stage || null,
    status: v.status || null,
    priority: Number(v.priority) || null,
    tags: v.tags || null,
    nextStepSummary: v.nextStepSummary || null,
    nextStepDueDate: v.nextStepDueDate || null,
    opportunityHours: Number(v.opportunityHours),
    opportunityTimeline: v.opportunityTimeline || null,
    plannedStartDate: v.plannedStartDate || null,
    plannedEndDate: v.plannedEndDate || null,
    allocationPercent: v.allocationPercent === "" ? null : Number(v.allocationPercent)
  };
}

async function refreshList() {
  loading.value = true;
  error.value = "";
  try {
    opportunities.value = await api.listOpportunities({
      q: q.value || "",
      sort: sort.value,
      dir: dir.value,
      stage: stageFilter.value || "",
      status: statusFilter.value || ""
    });
    try {
      assignments.value = await api.listAssignments({ includeHidden: true });
    } catch {
      assignments.value = [];
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function openDetail(id) {
  loading.value = true;
  error.value = "";
  try {
    selected.value = await api.getOpportunity(id);
    const o = selected.value.opportunity;

    form.value = {
      name: o.Name,
      technologyStack: o.TechnologyStack || "",
      description: o.Description || "",
      assignedPerson: o.TechOwner || "",
      businessOwner: o.BusinessOwner || "",
      firstContactDate: o.FirstContactDate?.slice(0, 10) || "",
      stage: o.Stage || "New",
      status: o.Status || "Open",
      priority: o.Priority ?? 3,
      tags: o.Tags || "",
      nextStepSummary: o.NextStepSummary || "",
      nextStepDueDate: o.NextStepDueDate?.slice(0, 10) || "",
      opportunityHours: o.OpportunityHours ?? "",
      opportunityTimeline: o.OpportunityTimeline || "",
      plannedStartDate: o.PlannedStartDate?.slice(0, 10) || "",
      plannedEndDate: o.PlannedEndDate?.slice(0, 10) || "",
      allocationPercent: o.AllocationPercent ?? 100
    };

    assignmentDraft.value = {
      personName: form.value.assignedPerson || people.value[0],
      plannedStartDate: form.value.plannedStartDate || new Date().toISOString().slice(0, 10),
      plannedEndDate: form.value.plannedEndDate || form.value.plannedStartDate || new Date().toISOString().slice(0, 10),
      allocatedHours: calculateAssignedHoursFromPercent(50, form.value.opportunityHours) || "",
      allocationPercent: 50,
    };
    initAssignmentEdits(selected.value.assignments);

    view.value = "detail";
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function goNew() {
  form.value = emptyForm();
  selected.value = null;
  view.value = "new";
}

function goPipeline() {
  view.value = "list";
}

function goConfiguration() {
  view.value = "configuration";
}

function addBusinessDays(date, daysToAdd) {
  const result = new Date(date);
  let remaining = Math.max(0, daysToAdd);

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return result;
}

function calculateEndDate(startDateValue, hours, allocationPercent) {
  const startDate = toDate(startDateValue);
  if (!startDate) return null;

  const percent = Number(allocationPercent || 100);
  if (percent <= 0) return null;

  const totalHours = Number(hours || 0);
  if (totalHours <= 0) return null;

  const dailyHours = HOURS_PER_DAY * (percent / 100);
  if (dailyHours <= 0) return null;

  const workDays = Math.max(1, Math.ceil(totalHours / dailyHours));
  const endDate = addBusinessDays(startDate, workDays - 1);
  return endDate.toISOString().slice(0, 10);
}

function calculateDurationWorkDays(hours, allocationPercent) {
  const percent = Number(allocationPercent || 100);
  const totalHours = Number(hours || 0);
  if (percent <= 0 || totalHours <= 0) return null;

  const dailyHours = HOURS_PER_DAY * (percent / 100);
  if (dailyHours <= 0) return null;

  return Math.max(1, Math.ceil(totalHours / dailyHours));
}

async function saveNew() {
  if (!form.value.opportunityHours || Number(form.value.opportunityHours) <= 0) {
    error.value = "Opportunity Hours is required and must be greater than 0.";
    return;
  }

  if (!form.value.plannedEndDate) {
    const calculatedEnd = calculateEndDate(
      form.value.plannedStartDate,
      form.value.opportunityHours,
      100
    );
    if (calculatedEnd) form.value.plannedEndDate = calculatedEnd;
  }

  loading.value = true;
  error.value = "";
  try {
    const r = await api.createOpportunity(normalizePayload(form.value));
    await refreshList();
    await openDetail(r.id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function saveEdit() {
  if (!selected.value) return;
  if (!form.value.opportunityHours || Number(form.value.opportunityHours) <= 0) {
    error.value = "Opportunity Hours is required and must be greater than 0.";
    return;
  }

  if (!form.value.plannedEndDate) {
    const calculatedEnd = calculateEndDate(
      form.value.plannedStartDate,
      form.value.opportunityHours,
      100
    );
    if (calculatedEnd) form.value.plannedEndDate = calculatedEnd;
  }

  loading.value = true;
  error.value = "";
  try {
    await api.updateOpportunity(selected.value.opportunity.Id, normalizePayload(form.value));
    await openDetail(selected.value.opportunity.Id);
    await refreshList();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function removeOpportunity() {
  if (!selected.value) return;
  if (!confirm("Delete this opportunity?")) return;

  loading.value = true;
  error.value = "";
  try {
    await api.deleteOpportunity(selected.value.opportunity.Id);
    selected.value = null;
    view.value = "list";
    await refreshList();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// Notes
const noteDate = ref(new Date().toISOString().slice(0, 10));
const noteContent = ref("");

async function addNote() {
  if (!selected.value || !noteContent.value.trim()) return;
  loading.value = true;
  error.value = "";
  try {
    await api.addNote(selected.value.opportunity.Id, { noteDate: noteDate.value, content: noteContent.value });
    noteContent.value = "";
    await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function deleteNote(noteId) {
  if (!confirm("Delete this note?")) return;
  loading.value = true;
  error.value = "";
  try {
    await api.deleteNote(noteId);
    await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// Steps
const stepTitle = ref("");
const stepDueDate = ref("");

async function addStep() {
  if (!selected.value || !stepTitle.value.trim()) return;
  loading.value = true;
  error.value = "";
  try {
    await api.addStep(selected.value.opportunity.Id, { title: stepTitle.value, dueDate: stepDueDate.value || null });
    stepTitle.value = "";
    stepDueDate.value = "";
    await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function toggleStep(s) {
  loading.value = true;
  error.value = "";
  try {
    await api.toggleStep(s.Id, { isDone: !s.IsDone });
    await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function deleteStep(stepId) {
  if (!confirm("Delete this step?")) return;
  loading.value = true;
  error.value = "";
  try {
    await api.deleteStep(stepId);
    await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function addAssignment() {
  if (!selected.value) return;
  const personName = assignmentDraft.value.personName?.trim();
  if (!personName) {
    error.value = "Assignment person is required.";
    return;
  }
  if (!assignmentDraft.value.plannedStartDate) {
    error.value = "Assignment start date is required.";
    return;
  }
  if (!assignmentDraft.value.plannedEndDate) {
    error.value = "Assignment end date is required.";
    return;
  }

  const allocationPercent = Number(assignmentDraft.value.allocationPercent || 0);
  const allocatedHours = Number(assignmentDraft.value.allocatedHours || assignmentDraftCalculatedHours());
  if (allocationPercent <= 0 || allocationPercent > 100) {
    error.value = "Allocation percent must be between 1 and 100.";
    return;
  }
  if (allocatedHours <= 0) {
    error.value = "Calculated assigned hours must be greater than 0.";
    return;
  }
  if (new Date(assignmentDraft.value.plannedEndDate) < new Date(assignmentDraft.value.plannedStartDate)) {
    error.value = "Assignment end date cannot be before start date.";
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    await api.addAssignment(selected.value.opportunity.Id, {
      personName,
      plannedStartDate: assignmentDraft.value.plannedStartDate,
      plannedEndDate: assignmentDraft.value.plannedEndDate,
      allocatedHours,
      allocationPercent,
      isTimelineVisible: true,
    });
    await refreshList();
    await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function updateAssignmentRange(assignmentId, plannedStartDate, plannedEndDate) {
  loading.value = true;
  error.value = "";
  try {
    await api.updateAssignment(assignmentId, { plannedStartDate, plannedEndDate });
    await refreshList();
    if (view.value === "detail" && selected.value) {
      await openDetail(selected.value.opportunity.Id);
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function stretchAssignment(assignment, daysDelta) {
  const end = toDate(assignment.PlannedEndDate);
  if (!end) return;
  end.setDate(end.getDate() + daysDelta);
  if (end < new Date(assignment.PlannedStartDate)) return;
  await updateAssignmentRange(
    assignment.Id,
    assignment.PlannedStartDate.slice(0, 10),
    end.toISOString().slice(0, 10)
  );
}

async function toggleTimelineVisibility(assignment, isVisible) {
  loading.value = true;
  error.value = "";
  try {
    await api.updateAssignment(assignment.Id, { isTimelineVisible: isVisible });
    await refreshList();
    if (selected.value) await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function addAssignmentFromTimeline() {
  const personName = timelineAssignmentDraft.value.personName?.trim();
  const opportunityId = timelineAssignmentDraft.value.opportunityId;
  const plannedStartDate = timelineAssignmentDraft.value.plannedStartDate;
  const plannedEndDate = timelineAssignmentDraft.value.plannedEndDate;
  const allocationPercent = Number(timelineAssignmentDraft.value.allocationPercent || 0);

  if (!personName) {
    error.value = "Assignment person is required.";
    return;
  }
  if (!opportunityId) {
    error.value = "Project is required.";
    return;
  }
  if (!plannedStartDate) {
    error.value = "Start date is required.";
    return;
  }
  if (!plannedEndDate) {
    error.value = "End date is required.";
    return;
  }
  if (new Date(plannedEndDate) < new Date(plannedStartDate)) {
    error.value = "End date cannot be before start date.";
    return;
  }
  if (allocationPercent <= 0 || allocationPercent > 100) {
    error.value = "Allocation percent must be between 1 and 100.";
    return;
  }

  const opportunity = opportunities.value.find((item) => item.Id === opportunityId);
  if (!opportunity) {
    error.value = "Selected project was not found.";
    return;
  }

  const allocatedHours = Number(timelineAssignmentDraft.value.allocatedHours || timelineDraftCalculatedHours());
  if (allocatedHours <= 0) {
    error.value = "Calculated assigned hours must be greater than 0.";
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    await api.addAssignment(opportunityId, {
      personName,
      plannedStartDate,
      plannedEndDate,
      allocatedHours,
      allocationPercent,
      isTimelineVisible: true,
    });
    await refreshList();
    timelineAssignmentDraft.value.opportunityId = "";
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function saveAssignmentEdit(assignmentId) {
  if (!selected.value) return;
  const edit = assignmentEdits.value[assignmentId];
  if (!edit) return;

  if (!edit.personName?.trim()) {
    error.value = "Assignment person is required.";
    return;
  }
  if (!edit.plannedStartDate) {
    error.value = "Assignment start date is required.";
    return;
  }
  if (!edit.plannedEndDate) {
    error.value = "Assignment end date is required.";
    return;
  }
  if (new Date(edit.plannedEndDate) < new Date(edit.plannedStartDate)) {
    error.value = "Assignment end date cannot be before start date.";
    return;
  }
  if (!edit.allocationPercent || Number(edit.allocationPercent) <= 0 || Number(edit.allocationPercent) > 100) {
    error.value = "Allocation percent must be between 1 and 100.";
    return;
  }
  const allocatedHours = assignmentEditCalculatedHours(assignmentId);
  if (allocatedHours <= 0) {
    error.value = "Calculated assigned hours must be greater than 0.";
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    await api.updateAssignment(assignmentId, {
      personName: edit.personName.trim(),
      plannedStartDate: edit.plannedStartDate,
      plannedEndDate: edit.plannedEndDate,
      allocatedHours,
      allocationPercent: Number(edit.allocationPercent),
      isTimelineVisible: !!edit.isTimelineVisible,
    });
    await refreshList();
    await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function deleteAssignment(assignmentId) {
  if (!selected.value) return;
  if (!confirm("Delete this assignment?")) return;

  loading.value = true;
  error.value = "";
  try {
    await api.deleteAssignment(assignmentId);
    await refreshList();
    await openDetail(selected.value.opportunity.Id);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

const count = computed(() => opportunities.value.length);

const assignmentRows = computed(() => {
  const byId = new Map(opportunities.value.map((o) => [o.Id, o]));
  return assignments.value
    .map((assignment) => {
      const opportunity = byId.get(assignment.OpportunityId);
      if (!opportunity) return null;
      return {
        ...assignment,
        OpportunityName: opportunity.Name,
        Stage: opportunity.Stage,
        Status: opportunity.Status,
        OpportunityHours: Number(opportunity.OpportunityHours || 0),
        AllocatedHours: Number.isFinite(Number(assignment.AllocatedHours))
          ? Number(assignment.AllocatedHours)
          : Math.round(Number(opportunity.OpportunityHours || 0) * (Number(assignment.AllocationPercent || 0) / 100) * 100) / 100,
      };
    })
    .filter(Boolean);
});

const managementPeople = computed(() => {
  const assignedPeople = assignmentRows.value.map((assignment) => assignment.PersonName).filter(Boolean);
  const businessDays = timelineCapacityBusinessDays.value;
  const capacityWindow = timelineCapacityWindow.value;

  return [...new Set([...people.value, ...assignedPeople])].map((person) => {
    const capacityHours = round2(businessDays * getPersonDailyHours(person));
    const assigned = assignmentRows.value.filter((assignment) => assignment.PersonName === person);
    const visible = assigned.filter((assignment) => assignment.IsTimelineVisible);
    const activeHours = visible.reduce((total, assignment) => {
      return total + assignmentHoursInWindow(assignment, capacityWindow.start, capacityWindow.endExclusive);
    }, 0);
    const assignedPercent = capacityHours > 0 ? Math.min(100, Math.max(0, (activeHours / capacityHours) * 100)) : 0;
    const availablePercent = Math.max(0, 100 - assignedPercent);

    return {
      person,
      assigned,
      dailyHours: getPersonDailyHours(person),
      capacityHours,
      activeHours: round2(activeHours),
      availableHours: round2(capacityHours - activeHours),
      assignedPercent,
      availablePercent,
    };
  });
});

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const scheduledOpportunities = computed(() => {
  return assignmentRows.value
    .filter((assignment) => assignment.IsTimelineVisible)
    .map((assignment) => ({
      ...assignment,
      StartDate: assignment.PlannedStartDate?.slice(0, 10),
      EndDate: assignment.PlannedEndDate?.slice(0, 10),
      TechOwner: assignment.PersonName,
      AllocationPercent: Number(assignment.AllocationPercent || 0),
    }));
});

const timelineDisplayedOpportunities = computed(() => {
  const selectedStage = (timelineStageFilter.value || "").toLowerCase();
  if (selectedStage === "free") return [];
  if (!selectedStage) return scheduledOpportunities.value;
  return scheduledOpportunities.value.filter((assignment) => String(assignment.Stage || "").toLowerCase() === selectedStage);
});

const timelineShowFreeBars = computed(() => {
  const selectedStage = (timelineStageFilter.value || "").toLowerCase();
  return selectedStage === "" || selectedStage === "free";
});

function startOfIsoWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

function periodBounds(key) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (key === "next-14") {
    const end = new Date(today);
    end.setDate(end.getDate() + 14);
    return { start: today, endInclusive: end };
  }
  if (key === "this-month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start, endInclusive: end };
  }
  const start = startOfIsoWeek(today);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, endInclusive: end };
}

function fmtDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

const upcomingWindow = computed(() => {
  return periodBounds(upcomingPeriod.value);
});

const upcomingLabel = computed(() => {
  const { start, endInclusive } = upcomingWindow.value;
  return `${fmtDate(start)} - ${fmtDate(endInclusive)}`;
});

const upcomingSteps = computed(() => {
  const { start, endInclusive } = upcomingWindow.value;
  const endMs = endInclusive.getTime();
  return opportunities.value
    .filter((item) => item.Status !== "Closed")
    .map((item) => {
      const due = toDate(item.NextStepDueDate);
      return {
        id: item.Id,
        name: item.Name,
        stage: item.Stage || "Unspecified",
        summary: item.NextStepSummary || "No next step summary",
        due,
      };
    })
    .filter((item) => item.due && item.due >= start && item.due.getTime() <= endMs)
    .sort((a, b) => a.due.getTime() - b.due.getTime());
});

function startOfUnit(date, perspective) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (perspective === "weeks") {
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d;
  }
  if (perspective === "quarters") {
    d.setDate(1);
    d.setMonth(Math.floor(d.getMonth() / 3) * 3);
    return d;
  }
  if (perspective === "halfyears") {
    d.setDate(1);
    d.setMonth(d.getMonth() < 6 ? 0 : 6);
    return d;
  }
  d.setDate(1);
  return d;
}

function addUnit(date, perspective, units) {
  const d = new Date(date);
  if (perspective === "weeks") {
    d.setDate(d.getDate() + units * 7);
    return d;
  }
  if (perspective === "quarters") {
    d.setMonth(d.getMonth() + units * 3);
    return d;
  }
  if (perspective === "halfyears") {
    d.setMonth(d.getMonth() + units * 6);
    return d;
  }
  d.setMonth(d.getMonth() + units);
  return d;
}

function formatUnitLabel(date, perspective) {
  if (perspective === "weeks") {
    return `W ${date.toLocaleDateString("en-US", { month: "short", day: "2-digit" })}`;
  }
  if (perspective === "quarters") {
    return `Q${Math.floor(date.getMonth() / 3) + 1} ${String(date.getFullYear()).slice(-2)}`;
  }
  if (perspective === "halfyears") {
    return `${date.getMonth() < 6 ? "H1" : "H2"} ${String(date.getFullYear()).slice(-2)}`;
  }
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function countBusinessDays(startDate, endExclusive) {
  let count = 0;
  const cursor = new Date(startDate);
  while (cursor < endExclusive) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function assignmentHoursInWindow(assignment, windowStart, windowEndExclusive) {
  const assignmentStart = toDate(assignment.PlannedStartDate || assignment.StartDate);
  const assignmentEnd = toDate(assignment.PlannedEndDate || assignment.EndDate);
  if (!assignmentStart || !assignmentEnd) return 0;

  const assignmentEndExclusive = new Date(assignmentEnd);
  assignmentEndExclusive.setDate(assignmentEndExclusive.getDate() + 1);

  const overlapStart = new Date(Math.max(assignmentStart.getTime(), windowStart.getTime()));
  const overlapEndExclusive = new Date(Math.min(assignmentEndExclusive.getTime(), windowEndExclusive.getTime()));
  if (overlapEndExclusive <= overlapStart) return 0;

  const totalBusinessDays = countBusinessDays(assignmentStart, assignmentEndExclusive);
  const overlapBusinessDays = countBusinessDays(overlapStart, overlapEndExclusive);
  if (totalBusinessDays <= 0 || overlapBusinessDays <= 0) return 0;

  const allocated = Number(assignment.AllocatedHours);
  const fallback = Number(assignment.OpportunityHours || 0) * (Number(assignment.AllocationPercent || 0) / 100);
  const totalHours = Number.isFinite(allocated) ? allocated : fallback;
  return totalHours * (overlapBusinessDays / totalBusinessDays);
}

function unitsToCoverRange(startDate, endDate, perspective) {
  let units = 0;
  let cursor = new Date(startDate);
  const target = new Date(endDate);
  while (cursor <= target && units < 240) {
    cursor = addUnit(cursor, perspective, 1);
    units += 1;
  }
  return Math.max(1, units);
}

const timelineUnitOptions = [
  { key: "weeks", label: "Weeks", defaultUnits: 12 },
  { key: "months", label: "Months", defaultUnits: 6 },
  { key: "quarters", label: "Quarter", defaultUnits: 4 },
  { key: "halfyears", label: "Half Year", defaultUnits: 2 },
];

const stageLegend = [
  { key: "new", label: "New", meaning: "Intake" },
  { key: "discovery", label: "Discovery", meaning: "Scoping" },
  { key: "proposal", label: "Proposal", meaning: "Proposal Ready" },
  { key: "negotiation", label: "Negotiation", meaning: "In Negotiation" },
  { key: "won", label: "Won", meaning: "Committed" },
  { key: "lost", label: "Lost", meaning: "Stopped" },
];

const timelineRange = computed(() => {
  const perspective = timelinePerspective.value;
  const horizonUnits = Math.max(1, Number(timelineUnitsToShow.value || 1));
  const dated = scheduledOpportunities.value.filter((item) => item.StartDate && item.EndDate);

  const nowStart = startOfUnit(new Date(), perspective);
  if (!dated.length) {
    const endExclusive = addUnit(nowStart, perspective, horizonUnits);
    return { start: nowStart, endExclusive, units: horizonUnits };
  }

  const minStart = new Date(Math.min(...dated.map((item) => new Date(item.StartDate).getTime())));
  const maxEnd = new Date(Math.max(...dated.map((item) => new Date(item.EndDate).getTime())));
  const start = startOfUnit(minStart, perspective);
  const unitsNeeded = unitsToCoverRange(start, maxEnd, perspective);
  const units = Math.max(horizonUnits, unitsNeeded);
  const endExclusive = addUnit(start, perspective, units);
  return { start, endExclusive, units };
});

const timelineUnits = computed(() => {
  const perspective = timelinePerspective.value;
  const { start, units } = timelineRange.value;
  return Array.from({ length: units }).map((_, index) => {
    const unitStart = addUnit(start, perspective, index);
    return {
      key: `${perspective}-${unitStart.toISOString().slice(0, 10)}`,
      label: formatUnitLabel(unitStart, perspective),
    };
  });
});

const timelineCapacityWindow = computed(() => {
  const perspective = timelinePerspective.value;
  const start = startOfUnit(new Date(), perspective);
  const units = Math.max(1, Number(timelineUnitsToShow.value || 1));
  const endExclusive = addUnit(start, perspective, units);
  return { start, endExclusive, units };
});

const timelineCapacityBusinessDays = computed(() => {
  const { start, endExclusive } = timelineCapacityWindow.value;
  return countBusinessDays(start, endExclusive);
});

const timelineCapacityHours = computed(() => {
  return timelineCapacityBusinessDays.value * HOURS_PER_DAY;
});

const timelineRows = computed(() => {
  const byPersonAll = new Map();
  const byPersonDisplayed = new Map();

  scheduledOpportunities.value.forEach((assignment) => {
    if (!byPersonAll.has(assignment.TechOwner)) {
      byPersonAll.set(assignment.TechOwner, []);
    }
    byPersonAll.get(assignment.TechOwner).push(assignment);
  });

  timelineDisplayedOpportunities.value.forEach((assignment) => {
    if (!byPersonDisplayed.has(assignment.TechOwner)) {
      byPersonDisplayed.set(assignment.TechOwner, []);
    }
    byPersonDisplayed.get(assignment.TechOwner).push(assignment);
  });

  return managementPeople.value.map((member) => {
    const assignmentsForPerson = (byPersonDisplayed.get(member.person) || [])
      .slice()
      .sort((a, b) => String(a.StartDate).localeCompare(String(b.StartDate)));
    const allAssignmentsForPerson = (byPersonAll.get(member.person) || [])
      .slice()
      .sort((a, b) => String(a.StartDate).localeCompare(String(b.StartDate)));
    const freeByMonth = monthlyFreeSegmentsForAssignments(allAssignmentsForPerson, member.person);
    return {
      person: member.person,
      activeHours: member.activeHours,
      capacityHours: member.capacityHours,
      availableHours: member.availableHours,
      assignedPercent: member.assignedPercent,
      availablePercent: member.availablePercent,
      freeByMonth,
      assignments: assignmentsForPerson,
    };
  });
});

const plannedEndPreview = computed(() => {
  return calculateEndDate(
    form.value.plannedStartDate,
    form.value.opportunityHours,
    100
  );
});

const plannedDurationPreview = computed(() => {
  return calculateDurationWorkDays(form.value.opportunityHours, 100);
});

const assignmentStats = computed(() => {
  const total = assignmentRows.value.length;
  const visible = assignmentRows.value.filter((item) => item.IsTimelineVisible).length;
  return { total, visible, hidden: total - visible };
});

const timelineProjects = computed(() => {
  return opportunities.value
    .slice()
    .sort((a, b) => String(a.Name || "").localeCompare(String(b.Name || "")));
});

function capacityClass(hours) {
  if (hours < 0) return "capacity-over";
  if (hours < 40) return "capacity-tight";
  return "capacity-available";
}


function stageBorderClass(stage) {
  switch ((stage || "").toLowerCase()) {
    case "discovery":
      return "border-warning";
    case "proposal":
      return "border-orange";
    case "negotiation":
      return "border-purple";
    case "won":
      return "border-success";
    case "lost":
      return "border-danger";
    case "new":
    default:
      return "border-secondary";
  }
}

function stageStatusLabel(stage) {
  switch ((stage || "").toLowerCase()) {
    case "new":
      return "Intake";
    case "discovery":
      return "Scoping";
    case "proposal":
      return "Proposal Ready";
    case "negotiation":
      return "In Negotiation";
    case "won":
      return "Committed";
    case "lost":
      return "Stopped";
    default:
      return "Unclassified";
  }
}

function stageAccentClass(stage) {
  const normalized = (stage || "").toLowerCase();
  if (["new", "discovery", "proposal", "negotiation", "won", "lost"].includes(normalized)) {
    return `accent-${normalized}`;
  }
  return "accent-new";
}

function assignmentEffectiveStartDate(assignment) {
  return resizePreviewById.value[assignment.Id]?.startDate || assignment.StartDate;
}

function assignmentEffectiveEndDate(assignment) {
  return resizePreviewById.value[assignment.Id]?.endDate || assignment.EndDate || assignment.StartDate;
}

function assignmentEffectiveAllocatedHours(assignment) {
  const preview = resizePreviewById.value[assignment.Id];
  const savedHours = Number(assignment.AllocatedHours);
  const fallbackHours = Number(assignment.OpportunityHours || 0) * (Number(assignment.AllocationPercent || 0) / 100);
  const baseHours = round2(Number.isFinite(savedHours) ? savedHours : fallbackHours);

  if (!preview) {
    return baseHours;
  }

  const start = toDate(assignmentEffectiveStartDate(assignment));
  const end = toDate(assignmentEffectiveEndDate(assignment));
  const percent = Number(assignment.AllocationPercent || 0);
  if (!start || !end || percent <= 0) {
    return baseHours;
  }

  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const businessDays = countBusinessDays(start, endExclusive);
  return round2(businessDays * HOURS_PER_DAY * (percent / 100));
}

function assignmentDurationDays(assignment) {
  const start = toDate(assignment.StartDate);
  const end = toDate(assignmentEffectiveEndDate(assignment));
  if (!start || !end) return 1;
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  return Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);
}

const TIMELINE_ROW_TOP_PADDING = 8;
const TIMELINE_LANE_HEIGHT = 58;

function timelineRectStyle(assignment, index) {
  const range = timelineRange.value;
  const rangeMs = range.endExclusive.getTime() - range.start.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const start = toDate(assignmentEffectiveStartDate(assignment));
  const end = toDate(assignmentEffectiveEndDate(assignment));
  if (!start || !end || rangeMs <= 0) {
    return { left: "0%", width: "1%", top: `${TIMELINE_ROW_TOP_PADDING + index * TIMELINE_LANE_HEIGHT}px` };
  }

  const clippedStart = start < range.start ? range.start : start;
  const clippedEndMs = Math.min(end.getTime() + dayMs, range.endExclusive.getTime());
  const clippedStartMs = clippedStart.getTime();
  const left = ((clippedStartMs - range.start.getTime()) / rangeMs) * 100;
  const width = ((clippedEndMs - clippedStartMs) / rangeMs) * 100;

  return {
    left: `${Math.max(0, Math.min(100, left))}%`,
    width: `${Math.max(1, Math.min(100, width))}%`,
    top: `${TIMELINE_ROW_TOP_PADDING + index * TIMELINE_LANE_HEIGHT}px`,
  };
}

function timelineRowHeight(assignmentsForPerson, includeFreeLane = false) {
  const lanes = Math.max(1, assignmentsForPerson.length + (includeFreeLane ? 1 : 0));
  return `${Math.max(TIMELINE_LANE_HEIGHT + TIMELINE_ROW_TOP_PADDING, lanes * TIMELINE_LANE_HEIGHT + TIMELINE_ROW_TOP_PADDING)}px`;
}

function timelineFreeRectStyle(startDate, endExclusive, assignmentsCount) {
  const range = timelineRange.value;
  const rangeMs = range.endExclusive.getTime() - range.start.getTime();
  if (rangeMs <= 0) {
    return {
      left: "0%",
      width: "0%",
      top: `${TIMELINE_ROW_TOP_PADDING + assignmentsCount * TIMELINE_LANE_HEIGHT}px`,
    };
  }

  const windowStartMs = Math.max(startDate.getTime(), range.start.getTime());
  const windowEndMs = Math.min(endExclusive.getTime(), range.endExclusive.getTime());
  if (windowEndMs <= windowStartMs) {
    return {
      left: "0%",
      width: "0%",
      top: `${TIMELINE_ROW_TOP_PADDING + assignmentsCount * TIMELINE_LANE_HEIGHT}px`,
    };
  }

  const left = ((windowStartMs - range.start.getTime()) / rangeMs) * 100;
  const width = ((windowEndMs - windowStartMs) / rangeMs) * 100;
  return {
    left: `${Math.max(0, Math.min(100, left))}%`,
    width: `${Math.max(1, Math.min(100, width))}%`,
    top: `${TIMELINE_ROW_TOP_PADDING + assignmentsCount * TIMELINE_LANE_HEIGHT}px`,
  };
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatMonthLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function monthlyFreeSegmentsForAssignments(assignmentsForPerson, personName) {
  const window = timelineCapacityWindow.value;
  const segments = [];

  let monthCursor = startOfMonth(window.start);
  while (monthCursor < window.endExclusive) {
    const nextMonth = addMonths(monthCursor, 1);
    const start = new Date(Math.max(monthCursor.getTime(), window.start.getTime()));
    const endExclusive = new Date(Math.min(nextMonth.getTime(), window.endExclusive.getTime()));
    if (endExclusive > start) {
      const capacityHours = countBusinessDays(start, endExclusive) * getPersonDailyHours(personName);
      const assignedHours = assignmentsForPerson.reduce((total, assignment) => {
        return total + assignmentHoursInWindow(assignment, start, endExclusive);
      }, 0);
      const freeHours = round2(capacityHours - assignedHours);

      segments.push({
        key: `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, "0")}`,
        monthLabel: formatMonthLabel(monthCursor),
        start,
        endExclusive,
        capacityHours: round2(capacityHours),
        freeHours,
      });
    }
    monthCursor = nextMonth;
  }

  return segments;
}

function resizeHandleMouseMove(event) {
  const state = resizeState.value;
  if (!state) return;

  const dayMs = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(1, Math.round((state.timelineEndExclusiveMs - state.timelineStartMs) / dayMs));
  const deltaDays = Math.round(((event.clientX - state.startX) / Math.max(1, state.trackWidth)) * totalDays);
  const baseStart = toDate(state.originalStartDate);
  const baseEnd = toDate(state.originalEndDate);
  if (!baseStart || !baseEnd) return;

  const nextStart = new Date(baseStart);
  const nextEnd = new Date(baseEnd);

  if (state.edge === "start") {
    nextStart.setDate(nextStart.getDate() + deltaDays);
    if (nextStart > nextEnd) {
      nextStart.setTime(nextEnd.getTime());
    }
  } else {
    nextEnd.setDate(nextEnd.getDate() + deltaDays);
    if (nextEnd < nextStart) {
      nextEnd.setTime(nextStart.getTime());
    }
  }

  resizePreviewById.value = {
    ...resizePreviewById.value,
    [state.assignmentId]: {
      startDate: nextStart.toISOString().slice(0, 10),
      endDate: nextEnd.toISOString().slice(0, 10),
    },
  };
}

async function resizeHandleMouseUp() {
  const state = resizeState.value;
  if (!state) return;

  window.removeEventListener("mousemove", resizeHandleMouseMove);
  window.removeEventListener("mouseup", resizeHandleMouseUp);

  const preview = resizePreviewById.value[state.assignmentId];
  resizeState.value = null;
  const startDate = preview?.startDate || state.originalStartDate;
  const endDate = preview?.endDate || state.originalEndDate;
  suppressTimelineOpenUntil.value = Date.now() + 350;
  resizePreviewById.value = Object.fromEntries(
    Object.entries(resizePreviewById.value).filter(([key]) => key !== state.assignmentId)
  );

  if (startDate === state.originalStartDate && endDate === state.originalEndDate) return;

  await updateAssignmentRange(state.assignmentId, startDate, endDate);
}

function startResizeAssignment(event, assignment, edge = "end") {
  event.preventDefault();
  event.stopPropagation();

  const currentStartDate = assignmentEffectiveStartDate(assignment);
  const currentEndDate = assignmentEffectiveEndDate(assignment);
  const track = event.currentTarget.closest(".timeline-row-track");
  const range = timelineRange.value;
  resizeState.value = {
    assignmentId: assignment.Id,
    startX: event.clientX,
    originalStartDate: currentStartDate,
    originalEndDate: currentEndDate,
    edge,
    trackWidth: track?.clientWidth || 1,
    timelineStartMs: range.start.getTime(),
    timelineEndExclusiveMs: range.endExclusive.getTime(),
  };

  window.addEventListener("mousemove", resizeHandleMouseMove);
  window.addEventListener("mouseup", resizeHandleMouseUp);
}

function handleTimelineChipClick(opportunity) {
  if (Date.now() < suppressTimelineOpenUntil.value || resizeState.value) {
    return;
  }
  openDetail(opportunity.OpportunityId);
}

function openAllocationModalForTimelineAssignment(opportunity) {
  openAllocationModal("timeline-edit", opportunity.Id);
}

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", resizeHandleMouseMove);
  window.removeEventListener("mouseup", resizeHandleMouseUp);
});

onMounted(() => {
  loadPeopleSettings();
  refreshList();
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="container app-header-inner">
        <div class="brand">OPPORTUNITIES</div>
        <nav class="app-nav" aria-label="Primary navigation">
          <button class="menu-item" :class="{ active: view === 'list' }" @click="view='list'" :aria-current="view === 'list' ? 'page' : undefined">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h10" /></svg>
            <span>Pipeline</span>
          </button>
          <button class="menu-item" :class="{ active: view === 'management' }" @click="view='management'" :aria-current="view === 'management' ? 'page' : undefined">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 19v-5m6 5V5m6 14v-8m4 8H2" /></svg>
            <span>Management</span>
          </button>
          <button class="menu-item" :class="{ active: view === 'configuration' }" @click="goConfiguration" :aria-current="view === 'configuration' ? 'page' : undefined">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7zm7.4-3.5a7.55 7.55 0 0 0-.1-1l2-1.6-2-3.5-2.4 1a7.84 7.84 0 0 0-1.7-1L15 3h-6l-.2 2.9a7.84 7.84 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.6a7.55 7.55 0 0 0 0 2l-2 1.6 2 3.5 2.4-1a7.84 7.84 0 0 0 1.7 1L9 21h6l.2-2.9a7.84 7.84 0 0 0 1.7-1l2.4 1 2-3.5-2-1.6c.1-.3.1-.7.1-1z" /></svg>
            <span>Configuration</span>
          </button>
        </nav>
        <button class="new-button" @click="goNew">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          <span>New opportunity</span>
        </button>
      </div>
    </header>

    <main class="container py-4">
      <div class="page-title mb-4">
        <div>
          <div class="eyebrow">Business development workspace</div>
          <h1>{{ view === 'management' ? 'Team capacity' : view === 'configuration' ? 'Configuration' : view === 'detail' ? 'Opportunity details' : view === 'new' ? 'Create opportunity' : 'Opportunity pipeline' }}</h1>
        </div>
        <div class="page-meta">{{ count }} opportunities</div>
      </div>

      <div v-if="error" class="alert alert-danger">{{ error }}</div>

      <!-- LIST -->
      <section v-if="view === 'list'">
        <div class="filter-bar mb-3">
          <div class="filter-search">
            <label class="form-label">Search</label>
            <input class="form-control" v-model="q" placeholder="Name, owner, or tag" @keyup.enter="refreshList" />
          </div>
          <div>
            <label class="form-label">Stage</label>
            <select class="form-select" v-model="stageFilter">
              <option value="">All stages</option>
              <option value="New">New</option>
              <option value="Discovery">Discovery</option>
              <option value="Proposal">Proposal</option>
              <option value="Negotiation">Negotiation</option>
              <option value="Won">Won</option>
              <option value="Lost">Lost</option>
            </select>
          </div>
          <div>
            <label class="form-label">Status</label>
            <select class="form-select" v-model="statusFilter">
              <option value="">All statuses</option>
              <option value="Open">Open</option>
              <option value="On Hold">On Hold</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
          <div>
            <label class="form-label">Sort</label>
            <select class="form-select" v-model="sort">
              <option value="updated">Recently updated</option>
              <option value="created">Recently created</option>
              <option value="name">Name</option>
            </select>
          </div>
          <button class="btn btn-primary refresh-button" @click="refreshList" :disabled="loading">
            {{ loading ? "Loading..." : "Refresh" }}
          </button>
        </div>

        <div class="pipeline-grid">
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Lead Consultant</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th class="text-end">Hours</th>
                  <th class="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="o in opportunities" :key="o.Id">
                  <td>
                    <div class="pipeline-title">{{ o.Name }}</div>
                    <div class="pipeline-subtitle">{{ o.TechnologyStack || "No technology stack" }}</div>
                  </td>
                  <td>{{ o.TechOwner || "Unassigned" }}</td>
                  <td><span class="badge" :class="stageBorderClass(o.Stage)">{{ o.Stage || "Unspecified" }}</span></td>
                  <td>{{ o.Status || "Unspecified" }}</td>
                  <td class="text-end fw-semibold">{{ o.OpportunityHours ?? 0 }}h</td>
                  <td class="text-end">
                    <div class="d-inline-flex gap-2 justify-content-end">
                      <button class="btn btn-primary btn-sm" @click="openDetail(o.Id)">Open</button>
                    </div>
                  </td>
                </tr>
                <tr v-if="!loading && !opportunities.length">
                  <td colspan="6" class="text-center text-muted py-4">No opportunities match the current filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="pipeline-upcoming mt-3">
          <div class="pipeline-upcoming-head">
            <div>
              <strong>Upcoming actions and decisions</strong>
              <div class="text-muted small">Items due in selected period (open opportunities only)</div>
            </div>
            <div class="d-flex align-items-center gap-2">
              <label class="form-label mb-0">Period</label>
              <select class="form-select form-select-sm upcoming-period" v-model="upcomingPeriod">
                <option value="this-week">This week</option>
                <option value="next-14">Next 14 days</option>
                <option value="this-month">This month</option>
              </select>
            </div>
          </div>
          <div class="upcoming-window small">{{ upcomingLabel }}</div>
          <div v-if="upcomingSteps.length" class="upcoming-list">
            <div v-for="item in upcomingSteps" :key="`upcoming-${item.id}`" class="upcoming-item" @click="openDetail(item.id)">
              <div class="upcoming-title">{{ item.name }}</div>
              <div class="upcoming-meta">{{ item.stage }} | Due {{ item.due?.toISOString().slice(0, 10) }}</div>
              <div class="upcoming-summary">{{ item.summary }}</div>
            </div>
          </div>
          <div v-else class="text-muted small">No upcoming steps for this period.</div>
        </div>
      </section>

      <section v-else-if="view === 'management'">
        <div class="capacity-intro mb-3">
          <strong>Planning capacity: {{ MONTHLY_CAPACITY }}h per month per person</strong>
          <div class="d-flex align-items-center gap-2">
            <label class="form-label mb-0">Perspective</label>
            <select class="form-select form-select-sm timeline-scale" v-model="timelinePerspective">
              <option v-for="option in timelineUnitOptions" :key="option.key" :value="option.key">{{ option.label }}</option>
            </select>
            <label class="form-label mb-0">Horizon</label>
            <input type="number" min="1" max="24" class="form-control form-control-sm timeline-horizon" v-model.number="timelineUnitsToShow" />
          </div>
          <span>Availability is calculated for the selected horizon. Hidden assignments stay in overview but are excluded from timeline load.</span>
        </div>

        <div class="assignment-stats mb-3">
          <span class="badge text-bg-primary">Assignments: {{ assignmentStats.total }}</span>
          <span class="badge text-bg-success">Visible: {{ assignmentStats.visible }}</span>
          <span class="badge text-bg-secondary">Hidden: {{ assignmentStats.hidden }}</span>
        </div>

        <div class="capacity-summary">
          <div v-for="member in managementPeople" :key="member.person" class="capacity-card">
            <div class="capacity-card-head">
              <strong>{{ member.person }}</strong>
              <span :class="capacityClass(member.availableHours)">{{ member.availableHours }}h free</span>
            </div>
            <div class="capacity-track">
              <span class="capacity-track-assigned" :style="{ width: `${member.assignedPercent}%` }" :class="capacityClass(member.availableHours)"></span>
              <span class="capacity-track-available" :style="{ width: `${member.availablePercent}%` }"></span>
            </div>
            <small>{{ member.activeHours }}h assigned / {{ Math.round(member.capacityHours) }}h capacity ({{ member.dailyHours }}h/day)</small>
          </div>
        </div>

        <div class="management-table-wrap">
          <table class="management-table">
            <thead><tr><th>Person</th><th>Assigned opportunity</th><th>Stage</th><th>Stage Status</th><th>Start</th><th>End</th><th>Alloc %</th><th class="hours-column">Hours</th><th>Timeline</th><th class="hours-column">Actions</th></tr></thead>
            <tbody v-for="member in managementPeople" :key="member.person">
              <tr v-if="member.assigned.length === 0" class="unassigned-row"><td>{{ member.person }}</td><td colspan="9">No opportunities assigned</td></tr>
              <tr v-for="(assignment, index) in member.assigned" :key="assignment.Id" class="management-row" :class="stageAccentClass(assignment.Stage)" @click="openDetail(assignment.OpportunityId)">
                <td v-if="index === 0" :rowspan="member.assigned.length" class="person-cell">{{ member.person }}</td>
                <td><span class="assignment-opportunity" :class="stageAccentClass(assignment.Stage)">{{ assignment.OpportunityName }}</span></td>
                <td><span class="stage-pill">{{ assignment.Stage || 'Unspecified' }}</span></td>
                <td><span class="stage-status">{{ stageStatusLabel(assignment.Stage) }}</span></td>
                <td>{{ assignment.PlannedStartDate?.slice(0, 10) || '-' }}</td>
                <td>{{ assignment.PlannedEndDate?.slice(0, 10) || '-' }}</td>
                <td>{{ assignment.AllocationPercent ?? 0 }}%</td>
                <td class="hours-column">{{ assignment.AllocatedHours ?? 0 }}h</td>
                <td>
                  <span v-if="assignment.IsTimelineVisible" class="badge text-bg-success">Visible</span>
                  <span v-else class="badge text-bg-secondary">Hidden</span>
                </td>
                <td class="hours-column" @click.stop>
                  <div class="d-inline-flex gap-1">
                    <button class="btn btn-primary btn-sm" @click="openDetail(assignment.OpportunityId)">Open</button>
                    <button v-if="assignment.IsTimelineVisible" class="btn btn-outline-danger btn-sm" @click="toggleTimelineVisibility(assignment, false)">Hide</button>
                    <button v-else class="btn btn-outline-success btn-sm" @click="toggleTimelineVisibility(assignment, true)">Show</button>
                  </div>
                </td>
              </tr>
              <tr v-if="member.assigned.length" class="person-total"><td colspan="6">{{ member.person }} active load</td><td>{{ member.availableHours }}h available</td><td class="hours-column">{{ member.activeHours }}h</td><td colspan="2"></td></tr>
            </tbody>
          </table>
        </div>

        <div class="timeline-wrap mt-4">
          <h5 class="mb-3">Project timeline</h5>
          <div class="timeline-quick-assign mb-3">
            <strong>Assign another project</strong>
            <div class="timeline-quick-assign-grid mt-2">
              <div>
                <label class="form-label">Person</label>
                <select class="form-select form-select-sm" v-model="timelineAssignmentDraft.personName">
                  <option value="">Select person</option>
                  <option v-for="person in managementPeople.map((m) => m.person)" :key="`timeline-person-${person}`" :value="person">{{ person }}</option>
                </select>
              </div>
              <div>
                <label class="form-label">Project</label>
                <select class="form-select form-select-sm" v-model="timelineAssignmentDraft.opportunityId" @change="syncTimelineDraftFromProject">
                  <option value="">Select project</option>
                  <option v-for="project in timelineProjects" :key="project.Id" :value="project.Id">{{ project.Name }} ({{ project.OpportunityHours ?? 0 }}h)</option>
                </select>
              </div>
              <div>
                <label class="form-label">Start date</label>
                <input type="date" class="form-control form-control-sm" v-model="timelineAssignmentDraft.plannedStartDate" />
              </div>
              <div>
                <label class="form-label">End date</label>
                <input type="date" class="form-control form-control-sm" v-model="timelineAssignmentDraft.plannedEndDate" />
              </div>
              <div class="timeline-quick-assign-action">
                <button class="btn btn-primary btn-sm" @click="openAllocationModal('timeline-create')" :disabled="loading">Assign</button>
              </div>
            </div>
            <div v-if="allocationModal.open && allocationModal.target === 'timeline-create'" class="allocation-inline-panel mt-2">
              <div class="allocation-inline-title">Allocation for new timeline assignment</div>
              <div class="allocation-inline-grid">
                <div>
                  <label class="form-label">Mode</label>
                  <select class="form-select form-select-sm" v-model="allocationMode">
                    <option value="percent">Percent of total opportunity hours</option>
                    <option value="total-hours">Total hours for selected period</option>
                    <option value="monthly-hours">Hours per month in selected period</option>
                  </select>
                </div>
                <div v-if="allocationMode === 'percent'">
                  <label class="form-label">Allocation %</label>
                  <input type="number" min="1" max="100" step="0.01" class="form-control form-control-sm" v-model.number="allocationInput.percent" />
                </div>
                <div v-if="allocationMode === 'total-hours'">
                  <label class="form-label">Total hours</label>
                  <input type="number" min="0.5" step="0.5" class="form-control form-control-sm" v-model.number="allocationInput.totalHours" />
                </div>
                <div v-if="allocationMode === 'monthly-hours'">
                  <label class="form-label">Hours per month</label>
                  <input type="number" min="0.5" step="0.5" class="form-control form-control-sm" v-model.number="allocationInput.monthlyHours" />
                </div>
                <div class="allocation-inline-preview">
                  <small>{{ allocationModalPreview.businessDays }} workdays, {{ allocationModalPreview.capacityHours }}h capacity, result: {{ allocationModalPreview.percent }}% / {{ allocationModalPreview.hours }}h</small>
                </div>
                <div class="allocation-inline-actions">
                  <button class="btn btn-outline-secondary btn-sm" @click="closeAllocationModal">Cancel</button>
                  <button class="btn btn-primary btn-sm" @click="applyAllocationModal">Apply and assign</button>
                </div>
              </div>
            </div>
            <div v-if="allocationModal.open && allocationModal.target === 'timeline-edit'" class="allocation-inline-panel mt-2">
              <div class="allocation-inline-title">Allocation for selected timeline assignment</div>
              <div class="allocation-inline-grid">
                <div>
                  <label class="form-label">Mode</label>
                  <select class="form-select form-select-sm" v-model="allocationMode">
                    <option value="percent">Percent of total opportunity hours</option>
                    <option value="total-hours">Total hours for selected period</option>
                    <option value="monthly-hours">Hours per month in selected period</option>
                  </select>
                </div>
                <div v-if="allocationMode === 'percent'">
                  <label class="form-label">Allocation %</label>
                  <input type="number" min="1" max="100" step="0.01" class="form-control form-control-sm" v-model.number="allocationInput.percent" />
                </div>
                <div v-if="allocationMode === 'total-hours'">
                  <label class="form-label">Total hours</label>
                  <input type="number" min="0.5" step="0.5" class="form-control form-control-sm" v-model.number="allocationInput.totalHours" />
                </div>
                <div v-if="allocationMode === 'monthly-hours'">
                  <label class="form-label">Hours per month</label>
                  <input type="number" min="0.5" step="0.5" class="form-control form-control-sm" v-model.number="allocationInput.monthlyHours" />
                </div>
                <div class="allocation-inline-preview">
                  <small>{{ allocationModalPreview.businessDays }} workdays, {{ allocationModalPreview.capacityHours }}h capacity, result: {{ allocationModalPreview.percent }}% / {{ allocationModalPreview.hours }}h</small>
                </div>
                <div class="allocation-inline-actions">
                  <button class="btn btn-outline-secondary btn-sm" @click="closeAllocationModal">Cancel</button>
                  <button class="btn btn-primary btn-sm" @click="applyAllocationModal">Apply changes</button>
                </div>
              </div>
            </div>
          </div>
          <div class="timeline-legend mb-3">
            <button class="btn btn-sm" :class="timelineStageFilter ? 'btn-outline-secondary' : 'btn-dark'" @click="toggleTimelineStageFilter('')">All stages</button>
            <div class="timeline-legend-item">
              <button class="timeline-legend-filter" :class="{ active: timelineStageFilter === 'free' }" @click="toggleTimelineStageFilter('free')">
                <span class="timeline-legend-accent timeline-legend-accent-free"></span>
                <span class="timeline-legend-text">Free for allocation</span>
              </button>
            </div>
            <div v-for="item in stageLegend" :key="item.key" class="timeline-legend-item">
              <button class="timeline-legend-filter" :class="{ active: timelineStageFilter === item.key }" @click="toggleTimelineStageFilter(item.key)">
                <span class="timeline-legend-accent" :class="`accent-${item.key}`"></span>
                <span class="timeline-legend-text">{{ item.label }}: {{ item.meaning }}</span>
              </button>
            </div>
          </div>
          <div class="timeline-grid-header">
            <div class="timeline-person-col">Person</div>
            <div class="timeline-scale-row">
              <div v-for="unit in timelineUnits" :key="unit.key" class="timeline-scale-cell">{{ unit.label }}</div>
            </div>
          </div>
          <div class="timeline-row" v-for="row in timelineRows" :key="row.person">
            <div class="timeline-person-col">{{ row.person }}</div>
            <div class="timeline-row-track" :style="{ height: timelineRowHeight(row.assignments, timelineShowFreeBars), '--units': Math.max(1, timelineUnits.length) }">
              <div
                v-for="(opportunity, index) in row.assignments"
                :key="opportunity.Id"
                class="timeline-chip"
                :class="stageAccentClass(opportunity.Stage)"
                :style="timelineRectStyle(opportunity, index)"
                @click="handleTimelineChipClick(opportunity)"
              >
                <div class="timeline-chip-title">{{ opportunity.OpportunityName }}</div>
                <div class="timeline-chip-meta">{{ assignmentEffectiveAllocatedHours(opportunity) }}h | {{ opportunity.AllocationPercent }}% | {{ assignmentEffectiveStartDate(opportunity) }} - {{ assignmentEffectiveEndDate(opportunity) || 'n/a' }}</div>
                <button class="timeline-chip-alloc-btn" @click.stop="openAllocationModalForTimelineAssignment(opportunity)" title="Edit allocation">Alloc</button>
                <div class="timeline-chip-resizer start" @mousedown="startResizeAssignment($event, opportunity, 'start')" title="Drag to move start date"></div>
                <div class="timeline-chip-resizer end" @mousedown="startResizeAssignment($event, opportunity, 'end')" title="Drag to move end date"></div>
              </div>
              <div
                v-if="timelineShowFreeBars"
                v-for="segment in row.freeByMonth"
                :key="`${row.person}-${segment.key}`"
                class="timeline-chip timeline-free-chip"
                :class="{ 'timeline-free-chip-over': segment.freeHours <= 0 }"
                :style="timelineFreeRectStyle(segment.start, segment.endExclusive, row.assignments.length)"
                title="Calculated monthly free capacity from current period"
              >
                <div class="timeline-chip-title">Free for allocation {{ segment.monthLabel }}</div>
                <div class="timeline-chip-meta" v-if="segment.freeHours > 0">{{ segment.freeHours }}h free / {{ segment.capacityHours }}h</div>
                <div class="timeline-chip-meta" v-else>No free capacity / {{ segment.capacityHours }}h</div>
              </div>
              <div v-if="!row.assignments.length" class="timeline-empty">No visible assignments</div>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="view === 'configuration'">
        <div class="people-management mb-3">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <strong>People management (daily capacity)</strong>
            <span class="text-muted small">Used for timeline capacity and allocation calculations</span>
          </div>
          <div class="people-grid">
            <div v-for="person in managementPeople.map((m) => m.person)" :key="`pm-${person}`" class="people-row">
              <span>{{ person }}</span>
              <input type="number" min="1" max="24" step="0.5" class="form-control form-control-sm" :value="getPersonDailyHours(person)" @change="updatePersonDailyHours(person, $event.target.value)" />
            </div>
            <div class="people-row">
              <input class="form-control form-control-sm" placeholder="Add person" v-model="newPersonName" />
              <input type="number" min="1" max="24" step="0.5" class="form-control form-control-sm" v-model.number="newPersonDailyHours" />
              <button class="btn btn-outline-secondary btn-sm" @click="addPerson">Add</button>
            </div>
          </div>
        </div>
      </section>

      <!-- NEW / DETAIL -->
      <section v-else>
        <div class="d-flex justify-content-between align-items-center mb-3">
          <div class="d-flex align-items-center gap-2">
            <button class="btn btn-outline-secondary btn-sm" @click="goPipeline">Back</button>
            <h4 class="mb-0">{{ view === "new" ? "Create Opportunity" : "Opportunity Details" }}</h4>
          </div>
          <div class="d-flex gap-2">
            <button v-if="view==='new'" class="btn btn-success" @click="saveNew" :disabled="loading">Create</button>
            <button v-if="view==='detail'" class="btn btn-success" @click="saveEdit" :disabled="loading">Save</button>
            <button v-if="view==='detail'" class="btn btn-outline-danger" @click="removeOpportunity" :disabled="loading">Delete</button>
          </div>
        </div>

      <div class="detail-summary" v-if="view==='detail' && selected">
        <div><span class="summary-label">Opportunity</span><strong>{{ selected.opportunity.Name }}</strong></div>
        <div><span class="summary-label">Stage</span><strong>{{ selected.opportunity.Stage || '-' }}</strong></div>
        <div><span class="summary-label">Status</span><strong>{{ selected.opportunity.Status || '-' }}</strong></div>
        <div><span class="summary-label">Assignments</span><strong>{{ (selected.assignments || []).length }}</strong></div>
      </div>

      <div class="row g-3">
        <div class="col-lg-6">
          <div class="card shadow-sm">
            <div class="card-header fw-bold">Basic Information</div>
            <div class="card-body row g-3">
              <div class="col-12">
                <label class="form-label">Opportunity Name</label>
                <input class="form-control" v-model="form.name" />
              </div>
              <div class="col-12">
                <label class="form-label">Technology Stack</label>
                <input class="form-control" v-model="form.technologyStack" />
              </div>
              <div class="col-12">
                <label class="form-label">Description</label>
                <textarea class="form-control" rows="4" v-model="form.description" placeholder="Describe the opportunity..."></textarea>
              </div>
              <div class="col-md-6">
                <label class="form-label">Lead Consultant</label>
                <select class="form-select" v-model="form.assignedPerson">
                  <option value="">Select person</option>
                  <option v-for="person in people" :key="person" :value="person">{{ person }}</option>
                </select>
              </div>
              <div class="col-md-6">
                <label class="form-label">Business Owner</label>
                <input class="form-control" v-model="form.businessOwner" />
              </div>
              <div class="col-md-6">
                <label class="form-label">First Contact Date</label>
                <input type="date" class="form-control" v-model="form.firstContactDate" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Tags</label>
                <input class="form-control" v-model="form.tags" placeholder="comma separated" />
              </div>
            </div>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card shadow-sm">
            <div class="card-header fw-bold">Planning and Capacity</div>
            <div class="card-body row g-3">
              <div class="col-md-4">
                <label class="form-label">Stage</label>
                <select class="form-select" v-model="form.stage">
                  <option>New</option>
                  <option>Discovery</option>
                  <option>Proposal</option>
                  <option>Negotiation</option>
                  <option>Won</option>
                  <option>Lost</option>
                </select>
              </div>
              <div class="col-md-4">
                <label class="form-label">Status</label>
                <select class="form-select" v-model="form.status">
                  <option>Open</option>
                  <option>On Hold</option>
                  <option>Closed</option>
                </select>
              </div>
              <div class="col-md-4">
                <label class="form-label">Priority</label>
                <select class="form-select" v-model.number="form.priority">
                  <option :value="1">1</option>
                  <option :value="2">2</option>
                  <option :value="3">3</option>
                  <option :value="4">4</option>
                  <option :value="5">5</option>
                </select>
              </div>

              <div class="col-12">
                <label class="form-label">Next Step Summary</label>
                <input class="form-control" v-model="form.nextStepSummary" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Next Step Due Date</label>
                <input type="date" class="form-control" v-model="form.nextStepDueDate" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Opportunity Hours</label>
                <input type="number" min="0.5" step="0.5" required class="form-control" v-model="form.opportunityHours" placeholder="e.g. 120" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Opportunity Timeline</label>
                <input class="form-control" v-model="form.opportunityTimeline" placeholder="e.g. 4 weeks" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Planned Start Date</label>
                <input type="date" class="form-control" v-model="form.plannedStartDate" />
              </div>
              <div class="col-md-4">
                <label class="form-label">Planned End Date</label>
                <input type="date" class="form-control" v-model="form.plannedEndDate" />
              </div>
              <div class="col-12 small text-muted">
                Calculated end date from hours: <strong>{{ plannedEndPreview || "set start date and hours" }}</strong>
                <span class="ms-2">Estimated duration: <strong>{{ plannedDurationPreview || "-" }} working days</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="view==='detail' && selected" class="card shadow-sm mt-3">
        <div class="card-header fw-bold">Assignments for Timeline</div>
        <div class="card-body">
          <div class="row g-2 align-items-end mb-3">
            <div class="col-md-4">
              <label class="form-label">Person</label>
              <select class="form-select" v-model="assignmentDraft.personName">
                <option v-for="person in people" :key="person" :value="person">{{ person }}</option>
              </select>
            </div>
            <div class="col-md-3">
              <label class="form-label">Start date</label>
              <input type="date" class="form-control" v-model="assignmentDraft.plannedStartDate" />
            </div>
            <div class="col-md-3">
              <label class="form-label">End date</label>
              <input type="date" class="form-control" v-model="assignmentDraft.plannedEndDate" />
            </div>
            <div class="col-md-2 text-end">
              <button class="btn btn-primary" @click="openAllocationModal('detail-create')" :disabled="loading">Add assignment</button>
            </div>
          </div>

          <div v-if="allocationModal.open && allocationModal.target === 'detail-create'" class="allocation-inline-panel mb-3">
            <div class="allocation-inline-title">Allocation for new assignment</div>
            <div class="allocation-inline-grid">
              <div>
                <label class="form-label">Mode</label>
                <select class="form-select form-select-sm" v-model="allocationMode">
                  <option value="percent">Percent of total opportunity hours</option>
                  <option value="total-hours">Total hours for selected period</option>
                  <option value="monthly-hours">Hours per month in selected period</option>
                </select>
              </div>
              <div v-if="allocationMode === 'percent'">
                <label class="form-label">Allocation %</label>
                <input type="number" min="1" max="100" step="0.01" class="form-control form-control-sm" v-model.number="allocationInput.percent" />
              </div>
              <div v-if="allocationMode === 'total-hours'">
                <label class="form-label">Total hours</label>
                <input type="number" min="0.5" step="0.5" class="form-control form-control-sm" v-model.number="allocationInput.totalHours" />
              </div>
              <div v-if="allocationMode === 'monthly-hours'">
                <label class="form-label">Hours per month</label>
                <input type="number" min="0.5" step="0.5" class="form-control form-control-sm" v-model.number="allocationInput.monthlyHours" />
              </div>
              <div class="allocation-inline-preview">
                <small>{{ allocationModalPreview.businessDays }} workdays, {{ allocationModalPreview.capacityHours }}h capacity, result: {{ allocationModalPreview.percent }}% / {{ allocationModalPreview.hours }}h</small>
              </div>
              <div class="allocation-inline-actions">
                <button class="btn btn-outline-secondary btn-sm" @click="closeAllocationModal">Cancel</button>
                <button class="btn btn-primary btn-sm" @click="applyAllocationModal">Apply and add</button>
              </div>
            </div>
          </div>

          <div v-for="assignment in (selected.assignments || [])" :key="assignment.Id" class="assignment-row">
            <div class="assignment-edit-grid">
              <select class="form-select form-select-sm" v-model="assignmentEdits[assignment.Id].personName">
                <option v-for="person in people" :key="person" :value="person">{{ person }}</option>
              </select>
              <input type="date" class="form-control form-control-sm" v-model="assignmentEdits[assignment.Id].plannedStartDate" />
              <input type="date" class="form-control form-control-sm" v-model="assignmentEdits[assignment.Id].plannedEndDate" />
              <input type="number" min="0" step="0.01" class="form-control form-control-sm" :value="assignmentEditCalculatedHours(assignment.Id)" readonly />
              <input type="number" min="1" max="100" class="form-control form-control-sm" v-model.number="assignmentEdits[assignment.Id].allocationPercent" @input="syncAssignmentEditFromPercent(assignment.Id, form.opportunityHours)" />
              <div class="small text-muted d-flex align-items-center">Calculated: {{ assignmentEditCalculatedHours(assignment.Id) }}h</div>
              <div class="form-check d-flex align-items-center gap-2">
                <input class="form-check-input" type="checkbox" :id="`visible-${assignment.Id}`" v-model="assignmentEdits[assignment.Id].isTimelineVisible" />
                <label class="form-check-label small" :for="`visible-${assignment.Id}`">Visible</label>
              </div>
            </div>
            <div class="d-flex gap-2 assignment-actions">
              <button class="btn btn-outline-secondary btn-sm" @click="stretchAssignment(assignment, -7)">-7d</button>
              <button class="btn btn-outline-secondary btn-sm" @click="stretchAssignment(assignment, 7)">+7d</button>
              <button class="btn btn-primary btn-sm" @click="saveAssignmentEdit(assignment.Id)">Save</button>
              <button class="btn btn-outline-danger btn-sm" @click="deleteAssignment(assignment.Id)">Delete</button>
            </div>
          </div>
          <div v-if="!(selected.assignments || []).length" class="small text-muted">No assignments yet. Add at least one person for timeline planning.</div>
        </div>
      </div>

      <!-- Notes & Steps -->
      <div v-if="view==='detail' && selected" class="row g-3 mt-1">
        <div class="col-lg-6">
          <div class="card shadow-sm">
            <div class="card-header fw-bold">Notes</div>
            <div class="card-body">
              <div class="row g-2 mb-3">
                <div class="col-4">
                  <input type="date" class="form-control" v-model="noteDate" />
                </div>
                <div class="col-6">
                  <input class="form-control" v-model="noteContent" placeholder="Add a note..." />
                </div>
                <div class="col-2">
                  <button class="btn btn-primary w-100" @click="addNote">Add</button>
                </div>
              </div>

              <div v-for="n in selected.notes" :key="n.Id" class="border rounded p-2 mb-2">
                <div class="d-flex justify-content-between">
                  <small class="text-muted">{{ n.NoteDate?.slice(0, 10) }}</small>
                  <button class="btn btn-sm btn-outline-danger" @click="deleteNote(n.Id)">Delete</button>
                </div>
                <div class="mt-2" style="white-space: pre-wrap;">{{ n.Content }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="col-lg-6">
          <div class="card shadow-sm">
            <div class="card-header fw-bold">Next Steps</div>
            <div class="card-body">
              <div class="row g-2 mb-3">
                <div class="col-7">
                  <input class="form-control" v-model="stepTitle" placeholder="Next step..." />
                </div>
                <div class="col-3">
                  <input type="date" class="form-control" v-model="stepDueDate" />
                </div>
                <div class="col-2">
                  <button class="btn btn-primary w-100" @click="addStep">Add</button>
                </div>
              </div>

              <div v-for="s in selected.nextSteps" :key="s.Id" class="border rounded p-2 mb-2 d-flex justify-content-between align-items-start">
                <div class="d-flex gap-2">
                  <input class="form-check-input mt-1" type="checkbox" :checked="s.IsDone" @change="toggleStep(s)" />
                  <div>
                    <div :class="{ 'text-decoration-line-through text-muted': s.IsDone }" class="fw-semibold">
                      {{ s.Title }}
                    </div>
                    <small class="text-muted">Due: {{ s.DueDate ? s.DueDate.slice(0, 10) : "-" }}</small>
                  </div>
                </div>
                <button class="btn btn-sm btn-outline-danger" @click="deleteStep(s.Id)">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="text-muted small mt-3">
        Tip: keep the server running on port 4000 and client on 5173.
      </div>
    </section>
    </main>
  </div>
</template>

<style scoped>
.filter-bar { display: grid; grid-template-columns: minmax(210px, 1.7fr) repeat(3, minmax(130px, 1fr)) auto; gap: 12px; align-items: end; padding: 16px; background: #fff; border: 1px solid #d6dde5; }
.form-label { margin-bottom: 5px; color: #435466; font-size: 12px; font-weight: 600; }
.refresh-button { min-width: 86px; }
.pipeline-grid { background: #fff; border: 1px solid #d6dde5; }
.pipeline-grid :deep(table) { margin-bottom: 0; }
.pipeline-grid :deep(th) { background: #edf1f5; color: #44576a; font-size: 11px; letter-spacing: .4px; text-transform: uppercase; }
.pipeline-grid :deep(td), .pipeline-grid :deep(th) { padding: 12px 14px; border-color: #e2e7ec; }
.pipeline-grid :deep(tr:hover td) { background: #eef7fa; }
.pipeline-title { color: #133b60; font-size: 14px; font-weight: 700; }
.pipeline-subtitle { color: #617182; font-size: 12px; }
.border-warning { background: #e6a700; color: #fff; }
.border-orange { background: #e56f00; color: #fff; }
.border-purple { background: #7152a1; color: #fff; }
.border-success { background: #107c41; color: #fff; }
.border-danger { background: #c4314b; color: #fff; }
.border-secondary { background: #637b91; color: #fff; }
.capacity-intro { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 13px 16px; border-left: 4px solid #00a6a6; background: #e7f4f4; color: #274c59; font-size: 13px; }
.capacity-intro span { color: #526979; }
.assignment-stats { display: flex; gap: 8px; }
.timeline-horizon { width: 88px; }
.timeline-scale { width: 130px; }
.capacity-summary { display: grid; grid-template-columns: repeat(5, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
.capacity-card { padding: 14px; background: #fff; border: 1px solid #d6dde5; }
.capacity-card-head { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.capacity-card small { color: #637080; font-size: 11px; }
.capacity-track { display: flex; height: 8px; margin: 13px 0 8px; overflow: hidden; background: #e6ebf0; }
.capacity-track-assigned, .capacity-track-available { display: block; height: 100%; }
.capacity-track-available { background: #cfe7dd; }
.capacity-available { color: #08736d; }.capacity-track .capacity-available { background: #00a6a6; }.capacity-tight { color: #b06000; }.capacity-track .capacity-tight { background: #e6a700; }.capacity-over { color: #b4233d; }.capacity-track .capacity-over { background: #c4314b; }
.management-table-wrap { overflow-x: auto; background: #fff; border: 1px solid #d6dde5; }
.management-table { width: 100%; min-width: 700px; border-collapse: collapse; font-size: 13px; }
.management-table th { padding: 11px 14px; background: #edf1f5; color: #44576a; font-size: 11px; letter-spacing: .4px; text-align: left; text-transform: uppercase; }
.management-table td { padding: 11px 14px; border-top: 1px solid #e2e7ec; }
.management-row { cursor: pointer; }.person-cell { color: #133b60; font-weight: 700; vertical-align: top; }.hours-column { text-align: right; }.unassigned-row td { color: #6b7a89; }.person-total { background: #f4f7f9; font-weight: 600; }.person-total td { border-top: 2px solid #ccd6df; }
.stage-status { font-weight: 600; color: #334f68; }
.assignment-opportunity { display: inline-block; padding-left: 8px; border-left: 4px solid #637b91; }
.timeline-wrap { background: #fff; border: 1px solid #d6dde5; padding: 14px; }
.timeline-quick-assign { padding: 10px 12px; border: 1px solid #d7e0e8; background: #f7fafc; }
.timeline-quick-assign-grid { display: grid; grid-template-columns: 1.2fr 1.6fr 1fr 1fr auto; gap: 10px; align-items: end; }
.timeline-quick-assign-action { display: flex; align-items: end; gap: 6px; }
.people-management { padding: 10px 12px; border: 1px solid #d7e0e8; background: #fbfdff; }
.people-grid { display: grid; gap: 8px; }
.people-row { display: grid; grid-template-columns: minmax(160px, 1fr) 120px auto; gap: 8px; align-items: center; }
.pipeline-upcoming { padding: 12px 14px; border: 1px solid #d7e0e8; background: #ffffff; }
.pipeline-upcoming-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 8px; }
.upcoming-period { width: 160px; }
.upcoming-window { color: #5f7387; margin-bottom: 8px; }
.upcoming-list { display: grid; gap: 8px; }
.upcoming-item { padding: 10px; border: 1px solid #e0e7ee; background: #f9fbfd; cursor: pointer; }
.upcoming-item:hover { background: #eef7fa; }
.upcoming-title { color: #153f62; font-weight: 700; }
.upcoming-meta { color: #5f7387; font-size: 12px; }
.upcoming-summary { color: #334f68; font-size: 13px; }
.timeline-grid-header { display: grid; grid-template-columns: 170px 1fr; border: 1px solid #e2e7ec; border-bottom: 0; }
.timeline-person-col { padding: 10px 12px; color: #153f62; font-weight: 700; border-right: 1px solid #e2e7ec; background: #f7fafc; }
.timeline-scale-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(80px, 1fr); }
.timeline-scale-cell { padding: 10px 8px; color: #44576a; font-size: 11px; letter-spacing: .4px; text-align: center; text-transform: uppercase; border-right: 1px solid #e2e7ec; background: #f3f6f9; }
.timeline-scale-cell:last-child { border-right: 0; }
.timeline-row { display: grid; grid-template-columns: 170px 1fr; border: 1px solid #e2e7ec; border-top: 0; }
.timeline-row-track { position: relative; overflow: visible; background:
  repeating-linear-gradient(to right, #f7fafc 0, #f7fafc calc(100% / var(--units, 1) - 1px), #e6edf3 calc(100% / var(--units, 1) - 1px), #e6edf3 calc(100% / var(--units, 1))); }
.timeline-chip { position: absolute; box-sizing: border-box; min-height: 48px; max-height: 48px; padding: 6px 16px 9px 16px; border: 1px solid #d6dde5; border-left: 5px solid #637b91; background: #f8fbfd; cursor: pointer; }
.timeline-free-chip { border-left-color: #8c98a6; background: #f1f3f6; cursor: default; }
.timeline-free-chip-over { border-left-color: #7a8795; background: #e8ebef; }
.timeline-chip-alloc-btn { position: absolute; right: 12px; top: 6px; border: 1px solid #c7d2dc; background: #ffffff; color: #33516f; font-size: 10px; line-height: 1; padding: 3px 6px; }
.timeline-chip-title { overflow: hidden; color: #153f62; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.timeline-chip-meta { overflow: hidden; color: #5f7387; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.timeline-chip-resizer { position: absolute; top: 0; width: 10px; height: 100%; cursor: ew-resize; }
.timeline-chip-resizer.start { left: 0; background: linear-gradient(90deg, rgba(16, 43, 78, .25) 0%, transparent 100%); }
.timeline-chip-resizer.end { right: 0; background: linear-gradient(90deg, transparent 0%, rgba(16, 43, 78, .25) 100%); }
.timeline-empty { color: #93a1af; padding: 12px; }
.timeline-legend { display: flex; flex-wrap: wrap; gap: 12px; }
.timeline-legend-item { display: inline-flex; align-items: center; gap: 7px; padding: 4px 8px; border: 1px solid #d6dde5; background: #fbfdff; }
.timeline-legend-accent { width: 14px; height: 14px; border-left: 5px solid var(--stage-accent, #637b91); border-top: 1px solid #cfd8e1; border-right: 1px solid #cfd8e1; border-bottom: 1px solid #cfd8e1; background: #f8fbfd; }
.timeline-legend-accent-free { border-left-color: #8c98a6; background: #f1f3f6; }
.timeline-legend-text { color: #44576a; font-size: 12px; }
.timeline-legend-filter { display: inline-flex; align-items: center; gap: 7px; border: 0; padding: 0; background: transparent; }
.timeline-legend-filter.active .timeline-legend-text { color: #173f63; font-weight: 700; }
.assignment-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px solid #e5e9ee; }
.detail-summary { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; padding: 12px 14px; background: #ffffff; border: 1px solid #dbe3ea; }
.summary-label { display: block; color: #6d7f90; font-size: 11px; letter-spacing: .4px; text-transform: uppercase; }
.assignment-edit-grid { display: grid; grid-template-columns: minmax(150px, 1fr) 126px 126px 92px 92px 120px 82px; gap: 8px; align-items: center; flex: 1; }
.assignment-actions { margin-left: 12px; }
.allocation-inline-panel { padding: 10px 12px; border: 1px solid #d7e0e8; background: #ffffff; }
.allocation-inline-title { margin-bottom: 6px; color: #27435d; font-size: 13px; font-weight: 700; }
.allocation-inline-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 8px; align-items: end; }
.allocation-inline-preview { grid-column: 1 / -1; color: #5f7387; }
.allocation-inline-actions { grid-column: 1 / -1; display: flex; justify-content: end; gap: 6px; }
.accent-new { --stage-accent: #637b91; }
.accent-discovery { --stage-accent: #e6a700; }
.accent-proposal { --stage-accent: #e56f00; }
.accent-negotiation { --stage-accent: #7152a1; }
.accent-won { --stage-accent: #107c41; }
.accent-lost { --stage-accent: #c4314b; }
.assignment-opportunity,
.timeline-chip { border-left-color: var(--stage-accent, #637b91); }
@media (max-width: 991px) { .filter-bar { grid-template-columns: repeat(2, 1fr); }.filter-search { grid-column: span 2; }.capacity-summary { grid-template-columns: repeat(2, 1fr); } .allocation-inline-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 991px) { .timeline-quick-assign-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) { .filter-bar { grid-template-columns: 1fr; }.filter-search { grid-column: auto; }.capacity-summary { grid-template-columns: 1fr; }.capacity-intro { align-items: start; flex-direction: column; gap: 4px; } .assignment-row { align-items: start; gap: 10px; flex-direction: column; } .assignment-edit-grid { grid-template-columns: 1fr 1fr; width: 100%; } .assignment-actions { margin-left: 0; } .detail-summary { grid-template-columns: 1fr 1fr; } .timeline-grid-header, .timeline-row { grid-template-columns: 120px 1fr; } .timeline-quick-assign-grid, .allocation-inline-grid, .people-row, .pipeline-upcoming-head { grid-template-columns: 1fr; display: grid; } .upcoming-period { width: 100%; } }
</style>
