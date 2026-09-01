<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "./api";

const view = ref("list"); // list | management | detail | new
const loading = ref(false);
const error = ref("");

const MONTHLY_CAPACITY = 160;
const WORK_DAYS_PER_MONTH = 20;
const HOURS_PER_DAY = MONTHLY_CAPACITY / WORK_DAYS_PER_MONTH;
const people = [
  "Anna Wacholak",
  "Jacek Szostak",
  "Grzegorz Nowakowski",
  "Krzysztof Bukowski",
  "Daniel Troska"
];

const q = ref("");
const sort = ref("updated");
const dir = ref("desc");
const stageFilter = ref("");
const statusFilter = ref("");

const opportunities = ref([]);
const selected = ref(null);

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
      form.value.allocationPercent
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
      form.value.allocationPercent
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

const count = computed(() => opportunities.value.length);

const managementPeople = computed(() => {
  const assignedPeople = opportunities.value.map((opportunity) => opportunity.TechOwner).filter(Boolean);
  return [...new Set([...people, ...assignedPeople])].map((person) => {
    const assigned = opportunities.value.filter((opportunity) => opportunity.TechOwner === person);
    const active = assigned.filter((opportunity) => opportunity.Status !== "Closed");
    const activeHours = active.reduce((total, opportunity) => total + Number(opportunity.OpportunityHours || 0), 0);

    return {
      person,
      assigned,
      activeHours,
      availableHours: MONTHLY_CAPACITY - activeHours
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
  const today = new Date().toISOString().slice(0, 10);

  return opportunities.value
    .filter((opportunity) => opportunity.TechOwner)
    .map((opportunity) => {
      const startDate = opportunity.PlannedStartDate?.slice(0, 10)
        || opportunity.FirstContactDate?.slice(0, 10)
        || today;

      const allocationPercent = Number(opportunity.AllocationPercent || 100);
      const calculatedEndDate = calculateEndDate(startDate, opportunity.OpportunityHours, allocationPercent);

      return {
        ...opportunity,
        StartDate: startDate,
        EndDate: opportunity.PlannedEndDate?.slice(0, 10) || calculatedEndDate,
        CalculatedEndDate: calculatedEndDate,
        AllocationPercent: allocationPercent
      };
    });
});

const timelineMonths = computed(() => {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), 1);

  const dated = scheduledOpportunities.value.filter((item) => item.StartDate && item.EndDate);
  if (dated.length) {
    const starts = dated.map((item) => new Date(item.StartDate));
    const ends = dated.map((item) => new Date(item.EndDate));
    const minStart = new Date(Math.min(...starts.map((date) => date.getTime())));
    const maxEnd = new Date(Math.max(...ends.map((date) => date.getTime())));

    base.setFullYear(minStart.getFullYear(), minStart.getMonth(), 1);
    const minRangeEnd = new Date(today.getFullYear(), today.getMonth() + 5, 1);
    const rangeEnd = maxEnd > minRangeEnd ? maxEnd : minRangeEnd;

    const months = [];
    const totalMonths = Math.max(
      6,
      (rangeEnd.getFullYear() - base.getFullYear()) * 12 + (rangeEnd.getMonth() - base.getMonth()) + 1
    );

    for (let i = 0; i < totalMonths; i += 1) {
      const monthDate = new Date(base.getFullYear(), base.getMonth() + i, 1);
      months.push({
        key: monthKey(monthDate),
        label: monthDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        date: monthDate
      });
    }

    return months;
  }

  const months = [];
  for (let i = 0; i < 6; i += 1) {
    const monthDate = new Date(base.getFullYear(), base.getMonth() + i, 1);
    months.push({
      key: monthKey(monthDate),
      label: monthDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      date: monthDate
    });
  }
  return months;
});

const timelineRows = computed(() => {
  const months = timelineMonths.value;
  const monthKeys = months.map((month) => month.key);
  const scheduledByPerson = new Map();

  scheduledOpportunities.value.forEach((opportunity) => {
    if (!scheduledByPerson.has(opportunity.TechOwner)) {
      scheduledByPerson.set(opportunity.TechOwner, []);
    }
    scheduledByPerson.get(opportunity.TechOwner).push(opportunity);
  });

  return managementPeople.value.map((member) => {
    const slots = Object.fromEntries(monthKeys.map((key) => [key, []]));
    const personItems = scheduledByPerson.get(member.person) || [];

    personItems.forEach((opportunity) => {
      const start = toDate(opportunity.StartDate);
      const end = toDate(opportunity.EndDate || opportunity.StartDate);
      if (!start || !end) return;

      months.forEach((month) => {
        const monthStart = month.date;
        const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
        if (start <= monthEnd && end >= monthStart) {
          slots[month.key].push(opportunity);
        }
      });
    });

    return {
      person: member.person,
      slots
    };
  });
});

const plannedEndPreview = computed(() => {
  return calculateEndDate(
    form.value.plannedStartDate,
    form.value.opportunityHours,
    form.value.allocationPercent
  );
});

const plannedDurationPreview = computed(() => {
  return calculateDurationWorkDays(form.value.opportunityHours, form.value.allocationPercent);
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

onMounted(refreshList);
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
          <h1>{{ view === 'management' ? 'Team capacity' : view === 'detail' ? 'Opportunity details' : view === 'new' ? 'Create opportunity' : 'Opportunity pipeline' }}</h1>
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
                  <th>Assigned</th>
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
      </section>

      <section v-else-if="view === 'management'">
        <div class="capacity-intro mb-3">
          <strong>Monthly planning capacity: {{ MONTHLY_CAPACITY }}h per person</strong>
          <span>Active load includes Open and On Hold opportunities. Closed work is shown below but does not consume capacity.</span>
        </div>

        <div class="capacity-summary">
          <div v-for="member in managementPeople" :key="member.person" class="capacity-card">
            <div class="capacity-card-head">
              <strong>{{ member.person }}</strong>
              <span :class="capacityClass(member.availableHours)">{{ member.availableHours }}h free</span>
            </div>
            <div class="capacity-track"><span :style="{ width: `${Math.min(100, Math.max(0, member.activeHours / MONTHLY_CAPACITY * 100))}%` }" :class="capacityClass(member.availableHours)"></span></div>
            <small>{{ member.activeHours }}h assigned / {{ MONTHLY_CAPACITY }}h capacity</small>
          </div>
        </div>

        <div class="management-table-wrap">
          <table class="management-table">
            <thead><tr><th>Person</th><th>Assigned opportunity</th><th>Stage</th><th>Status</th><th class="hours-column">Hours</th><th class="hours-column">Actions</th></tr></thead>
            <tbody v-for="member in managementPeople" :key="member.person">
              <tr v-if="member.assigned.length === 0" class="unassigned-row"><td>{{ member.person }}</td><td colspan="5">No opportunities assigned</td></tr>
              <tr v-for="(opportunity, index) in member.assigned" :key="opportunity.Id" class="management-row" @click="openDetail(opportunity.Id)">
                <td v-if="index === 0" :rowspan="member.assigned.length" class="person-cell">{{ member.person }}</td>
                <td>{{ opportunity.Name }}</td><td><span class="stage-pill">{{ opportunity.Stage || 'Unspecified' }}</span></td><td>{{ opportunity.Status || 'Unspecified' }}</td><td class="hours-column">{{ opportunity.OpportunityHours ?? 0 }}h</td>
                <td class="hours-column" @click.stop><button class="btn btn-primary btn-sm" @click="openDetail(opportunity.Id)">Open</button></td>
              </tr>
              <tr v-if="member.assigned.length" class="person-total"><td colspan="3">{{ member.person }} active load</td><td>{{ member.availableHours }}h available</td><td class="hours-column">{{ member.activeHours }}h</td><td></td></tr>
            </tbody>
          </table>
        </div>

        <div class="timeline-wrap mt-4">
          <h5 class="mb-3">Project timeline</h5>
          <div class="table-responsive">
            <table class="timeline-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th v-for="month in timelineMonths" :key="month.key">{{ month.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in timelineRows" :key="row.person">
                  <td class="timeline-person">{{ row.person }}</td>
                  <td v-for="month in timelineMonths" :key="`${row.person}-${month.key}`">
                    <button
                      v-for="opportunity in row.slots[month.key]"
                      :key="`${opportunity.Id}-${month.key}`"
                      class="btn btn-outline-primary btn-sm timeline-chip"
                      @click="openDetail(opportunity.Id)"
                    >
                      {{ opportunity.Name }} | {{ opportunity.OpportunityHours ?? 0 }}h | {{ opportunity.AllocationPercent }}% | {{ opportunity.StartDate }} - {{ opportunity.EndDate || 'n/a' }} | {{ calculateDurationWorkDays(opportunity.OpportunityHours, opportunity.AllocationPercent) || '-' }} wd
                    </button>
                    <span v-if="!row.slots[month.key].length" class="timeline-empty">-</span>
                  </td>
                </tr>
              </tbody>
            </table>
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

      <div class="row g-3">
        <div class="col-lg-6">
          <div class="card shadow-sm">
            <div class="card-header fw-bold">Core</div>
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
                <label class="form-label">Assigned Person</label>
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
            <div class="card-header fw-bold">Pipeline</div>
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
              <div class="col-md-4">
                <label class="form-label">Allocation %</label>
                <input type="number" min="1" max="100" class="form-control" v-model.number="form.allocationPercent" />
              </div>
              <div class="col-12 small text-muted">
                Calculated end date from hours and allocation: <strong>{{ plannedEndPreview || "set start date and hours" }}</strong>
                <span class="ms-2">Estimated duration: <strong>{{ plannedDurationPreview || "-" }} working days</strong></span>
              </div>
            </div>
          </div>
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
.capacity-summary { display: grid; grid-template-columns: repeat(5, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
.capacity-card { padding: 14px; background: #fff; border: 1px solid #d6dde5; }
.capacity-card-head { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
.capacity-card small { color: #637080; font-size: 11px; }
.capacity-track { height: 7px; margin: 13px 0 8px; overflow: hidden; background: #e6ebf0; }
.capacity-track span { display: block; height: 100%; background: #00a6a6; }
.capacity-available { color: #08736d; }.capacity-track .capacity-available { background: #00a6a6; }.capacity-tight { color: #b06000; }.capacity-track .capacity-tight { background: #e6a700; }.capacity-over { color: #b4233d; }.capacity-track .capacity-over { background: #c4314b; }
.management-table-wrap { overflow-x: auto; background: #fff; border: 1px solid #d6dde5; }
.management-table { width: 100%; min-width: 700px; border-collapse: collapse; font-size: 13px; }
.management-table th { padding: 11px 14px; background: #edf1f5; color: #44576a; font-size: 11px; letter-spacing: .4px; text-align: left; text-transform: uppercase; }
.management-table td { padding: 11px 14px; border-top: 1px solid #e2e7ec; }
.management-row { cursor: pointer; }.person-cell { color: #133b60; font-weight: 700; vertical-align: top; }.hours-column { text-align: right; }.unassigned-row td { color: #6b7a89; }.person-total { background: #f4f7f9; font-weight: 600; }.person-total td { border-top: 2px solid #ccd6df; }
.timeline-wrap { background: #fff; border: 1px solid #d6dde5; padding: 14px; }
.timeline-table { width: 100%; min-width: 860px; border-collapse: collapse; font-size: 13px; }
.timeline-table th, .timeline-table td { padding: 10px 12px; border: 1px solid #e2e7ec; vertical-align: top; }
.timeline-table th { background: #f3f6f9; color: #44576a; font-size: 11px; letter-spacing: .4px; text-transform: uppercase; }
.timeline-person { color: #133b60; font-weight: 700; white-space: nowrap; }
.timeline-chip { display: block; width: 100%; margin-bottom: 6px; text-align: left; }
.timeline-empty { color: #93a1af; }
@media (max-width: 991px) { .filter-bar { grid-template-columns: repeat(2, 1fr); }.filter-search { grid-column: span 2; }.capacity-summary { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 600px) { .filter-bar { grid-template-columns: 1fr; }.filter-search { grid-column: auto; }.capacity-summary { grid-template-columns: 1fr; }.capacity-intro { align-items: start; flex-direction: column; gap: 4px; } }
</style>
