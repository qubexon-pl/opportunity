<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "./api";

const view = ref("list"); // list | management | detail | new
const loading = ref(false);
const error = ref("");

const MONTHLY_CAPACITY = 160;
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
  opportunityTimeline: ""
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
    opportunityHours: v.opportunityHours === "" ? null : Number(v.opportunityHours),
    opportunityTimeline: v.opportunityTimeline || null
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
      opportunityTimeline: o.OpportunityTimeline || ""
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

async function saveNew() {
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
          <button :class="{ active: view === 'list' }" @click="view='list'">Pipeline</button>
          <button :class="{ active: view === 'management' }" @click="view='management'">Management</button>
        </nav>
        <button class="btn btn-light btn-sm new-button" @click="goNew">New opportunity</button>
      </div>
    </header>

    <main class="container py-4">
      <div class="page-title mb-4">
        <div>
          <div class="eyebrow">Business development workspace</div>
          <h1>{{ view === 'management' ? 'Team capacity' : 'Opportunity pipeline' }}</h1>
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
          <article v-for="o in opportunities" :key="o.Id" class="opportunity-row" @click="openDetail(o.Id)">
            <div class="stage-marker" :class="stageBorderClass(o.Stage)"></div>
            <div class="opportunity-name">
              <strong>{{ o.Name }}</strong>
              <span>{{ o.TechnologyStack || 'No technology stack' }}</span>
            </div>
            <div><span class="data-label">Owner</span>{{ o.TechOwner || 'Unassigned' }}</div>
            <div><span class="data-label">Stage</span><span class="stage-pill">{{ o.Stage || 'Unspecified' }}</span></div>
            <div><span class="data-label">Status</span>{{ o.Status || 'Unspecified' }}</div>
            <div><span class="data-label">Planned</span><strong>{{ o.OpportunityHours ?? 0 }}h</strong></div>
            <button class="btn btn-outline-primary btn-sm" @click.stop="openDetail(o.Id)">Open</button>
          </article>
          <div v-if="!loading && !opportunities.length" class="empty-state">No opportunities match the current filters.</div>
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
            <thead><tr><th>Person</th><th>Assigned opportunity</th><th>Stage</th><th>Status</th><th class="hours-column">Hours</th></tr></thead>
            <tbody v-for="member in managementPeople" :key="member.person">
              <tr v-if="member.assigned.length === 0" class="unassigned-row"><td>{{ member.person }}</td><td colspan="4">No opportunities assigned</td></tr>
              <tr v-for="(opportunity, index) in member.assigned" :key="opportunity.Id" class="management-row" @click="openDetail(opportunity.Id)">
                <td v-if="index === 0" :rowspan="member.assigned.length" class="person-cell">{{ member.person }}</td>
                <td>{{ opportunity.Name }}</td><td><span class="stage-pill">{{ opportunity.Stage || 'Unspecified' }}</span></td><td>{{ opportunity.Status || 'Unspecified' }}</td><td class="hours-column">{{ opportunity.OpportunityHours ?? 0 }}h</td>
              </tr>
              <tr v-if="member.assigned.length" class="person-total"><td colspan="3">{{ member.person }} active load</td><td>{{ member.availableHours }}h available</td><td class="hours-column">{{ member.activeHours }}h</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- NEW / DETAIL -->
      <section v-else>
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h4 class="mb-0">{{ view === "new" ? "Create Opportunity" : "Opportunity Details" }}</h4>
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
                <input type="number" min="0" step="0.5" class="form-control" v-model="form.opportunityHours" placeholder="e.g. 120" />
              </div>
              <div class="col-md-6">
                <label class="form-label">Opportunity Timeline</label>
                <input class="form-control" v-model="form.opportunityTimeline" placeholder="e.g. 4 weeks" />
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
.opportunity-row { display: grid; grid-template-columns: 5px minmax(170px, 1.8fr) minmax(130px, 1.1fr) minmax(100px, .8fr) minmax(85px, .7fr) 75px 54px; gap: 16px; align-items: center; min-height: 75px; padding: 12px 16px 12px 0; border-bottom: 1px solid #e4e9ee; cursor: pointer; font-size: 13px; }
.opportunity-row:hover, .management-row:hover { background: #eef7fa; }
.opportunity-name { display: grid; gap: 3px; min-width: 0; }
.opportunity-name strong { color: #133b60; font-size: 14px; }
.opportunity-name span { overflow: hidden; color: #617182; text-overflow: ellipsis; white-space: nowrap; }
.data-label { display: block; margin-bottom: 3px; color: #6b7a89; font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
.stage-marker { align-self: stretch; background: #8495a7; }
.border-warning { background: #e6a700; }.border-orange { background: #e56f00; }.border-purple { background: #7152a1; }.border-success { background: #107c41; }.border-danger { background: #c4314b; }.border-secondary { background: #637b91; }
.stage-pill { display: inline-block; color: #294c69; font-size: 12px; font-weight: 600; }
.empty-state { padding: 38px; color: #637080; text-align: center; }
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
@media (max-width: 991px) { .filter-bar { grid-template-columns: repeat(2, 1fr); }.filter-search { grid-column: span 2; }.capacity-summary { grid-template-columns: repeat(2, 1fr); }.opportunity-row { grid-template-columns: 5px 1.5fr 1fr 75px 54px; }.opportunity-row > div:nth-of-type(3), .opportunity-row > div:nth-of-type(4) { display: none; } }
@media (max-width: 600px) { .filter-bar { grid-template-columns: 1fr; }.filter-search { grid-column: auto; }.capacity-summary { grid-template-columns: 1fr; }.capacity-intro { align-items: start; flex-direction: column; gap: 4px; }.opportunity-row { grid-template-columns: 5px minmax(0, 1fr) 62px 48px; gap: 10px; }.opportunity-row > div:nth-of-type(2), .opportunity-row > div:nth-of-type(3), .opportunity-row > div:nth-of-type(4) { display: none; } }
</style>
