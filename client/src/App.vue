<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "./api";

const view = ref("list"); // list | detail | new
const loading = ref(false);
const error = ref("");

const q = ref("");
const sort = ref("updated");
const dir = ref("desc");

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
      dir: dir.value
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
  <div class="container py-4">
    <!-- Header -->
    <div class="d-flex justify-content-between align-items-center mb-4">
      <div>
        <h3 class="mb-0">Opportunity Tracker</h3>
        <small class="text-muted">Vue + Azure SQL (via Node API)</small>
      </div>
      <div class="btn-group">
        <button class="btn btn-outline-primary" @click="view='list'">List</button>
        <button class="btn btn-primary" @click="goNew">New</button>
      </div>
    </div>

    <div v-if="error" class="alert alert-danger">{{ error }}</div>

    <!-- LIST -->
    <section v-if="view === 'list'">
      <div class="row g-3 mb-3 align-items-end">
        <div class="col-md-5">
          <label class="form-label">Search</label>
          <input class="form-control" v-model="q" placeholder="name, owners, tags" />
        </div>
        <div class="col-md-2">
          <label class="form-label">Sort</label>
          <select class="form-select" v-model="sort">
            <option value="updated">Updated</option>
            <option value="created">Created</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div class="col-md-2">
          <label class="form-label">Direction</label>
          <select class="form-select" v-model="dir">
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </div>
        <div class="col-md-3">
          <button class="btn btn-secondary w-100" @click="refreshList" :disabled="loading">
            {{ loading ? "Loading..." : "Refresh" }}
          </button>
        </div>
      </div>

      <div class="text-muted mb-2">{{ count }} results</div>

      <div class="row g-3">
        <div class="col-md-4" v-for="o in opportunities" :key="o.Id">
          <div class="card shadow-sm h-100 border-2" :class="stageBorderClass(o.Stage)">
            <div class="card-body">
              <div class="d-flex justify-content-between">
                <h5 class="card-title mb-1">{{ o.Name }}</h5>
                <span class="badge text-bg-secondary">P{{ o.Priority ?? "-" }}</span>
              </div>
              <div class="small text-muted mb-2">
                Stage: {{ o.Stage || "-" }} • Status: {{ o.Status || "-" }}
              </div>
              <div class="small">
                <div><b>Assigned:</b> {{ o.TechOwner || "-" }}</div>
                <div><b>Biz:</b> {{ o.BusinessOwner || "-" }}</div>
              </div>
              <div class="small text-muted mt-2">Tags: {{ o.Tags || "-" }}</div>
              <div class="small text-muted">{{ o.Description || "" }}</div>
              <div class="small text-muted">Hours: {{ o.OpportunityHours ?? "-" }} • Timeline: {{ o.OpportunityTimeline || "-" }}</div>

              <button class="btn btn-sm btn-outline-primary mt-3" @click="openDetail(o.Id)">
                Open
              </button>
            </div>
          </div>
        </div>
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
                  <option>Anna Wacholak</option>
                  <option>Jacek Szostak</option>
                  <option>Grzegorz Nowakowski</option>
                  <option>Krzysztof Bukowski</option>
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
  </div>
</template>

<style scoped>
.border-orange { border-color: #fd7e14 !important; }
.border-purple { border-color: #6f42c1 !important; }
</style>
