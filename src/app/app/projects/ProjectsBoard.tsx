"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addProject,
  updateProjectStatus,
  updateProjectDetails,
  deleteProject,
} from "../actions";

export type Project = {
  id: string;
  category: string;
  name: string;
  status: "not_started" | "in_progress" | "waiting" | "done";
  notes: string | null;
  materials: string[];
  next_step: string | null;
  next_step_date: string | null;
  created_by: string;
  created_at: string;
};

const STATUS_LABEL: Record<Project["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
};

const STATUS_STYLE: Record<Project["status"], string> = {
  not_started: "bg-gray-100 text-gray-600",
  in_progress: "bg-sky-100 text-sky-700",
  waiting: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
};

export default function ProjectsBoard({
  familyId,
  initialProjects,
}: {
  familyId: string;
  initialProjects: Project[];
}) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`projects:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "projects",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          setProjects((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((p) => p.id !== (payload.old as Project).id);
            }
            const row = payload.new as Project;
            const exists = prev.some((p) => p.id === row.id);
            if (exists) return prev.map((p) => (p.id === row.id ? row : p));
            return [...prev, row];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId]);

  const existingCategories = useMemo(
    () => Array.from(new Set(projects.map((p) => p.category))).sort(),
    [projects]
  );

  const grouped = useMemo(() => {
    const visible = projects.filter((p) =>
      showArchived ? p.status === "done" : p.status !== "done"
    );
    const byCategory = new Map<string, Project[]>();
    for (const p of visible) {
      const list = byCategory.get(p.category) ?? [];
      list.push(p);
      byCategory.set(p.category, list);
    }
    return Array.from(byCategory.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
  }, [projects, showArchived]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const n = name;
    const c = category;
    setName("");
    setCategory("");
    await addProject(familyId, c || "Other", n);
  }

  return (
    <div>
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project…"
          className="w-full sm:w-auto sm:flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          list="project-categories"
          className="w-full sm:w-40 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <datalist id="project-categories">
          {existingCategories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex-1 sm:flex-none bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-lg"
        >
          Add
        </button>
      </form>

      <button
        onClick={() => setShowArchived((v) => !v)}
        className="text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        {showArchived ? "← Back to active projects" : "View done projects →"}
      </button>

      {grouped.length === 0 ? (
        <p className="text-center text-gray-400 py-10">
          {showArchived
            ? "No done projects yet."
            : "No projects yet. Add one above! 📌"}
        </p>
      ) : (
        grouped.map(([cat, items]) => (
          <div key={cat} className="mb-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 px-1">
              {cat}
            </h2>
            <div className="space-y-2">
              {items.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  expanded={expanded === p.id}
                  onToggle={() =>
                    setExpanded((cur) => (cur === p.id ? null : p.id))
                  }
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ProjectCard({
  project,
  expanded,
  onToggle,
}: {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [notes, setNotes] = useState(project.notes ?? "");
  const [materials, setMaterials] = useState(
    (project.materials ?? []).join(", ")
  );
  const [nextStep, setNextStep] = useState(project.next_step ?? "");
  const [nextStepDate, setNextStepDate] = useState(
    project.next_step_date ?? ""
  );
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    await updateProjectDetails(project.id, {
      notes,
      materials: materials.split(",").map((m) => m.trim()).filter(Boolean),
      next_step: nextStep,
      next_step_date: nextStepDate || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function handleStatus(status: Project["status"]) {
    await updateProjectStatus(project.id, status);
  }

  async function handleDelete() {
    if (!confirm(`Delete "${project.name}"? This can't be undone.`)) return;
    await deleteProject(project.id);
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left flex flex-col gap-1.5 bg-white hover:bg-gray-50 px-4 py-3"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-800">{project.name}</span>
          <span
            className={`shrink-0 transition-transform text-gray-400 ${
              expanded ? "rotate-180" : ""
            }`}
          >
            ▾
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLE[project.status]}`}
          >
            {STATUS_LABEL[project.status]}
          </span>
          {project.next_step && (
            <span className="text-xs text-gray-400 truncate">
              {project.next_step}
              {project.next_step_date &&
                ` · ${new Date(
                  project.next_step_date + "T00:00:00"
                ).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}`}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="bg-gray-50 border-t border-gray-200 px-4 py-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(STATUS_LABEL) as Project["status"][]).map((s) => (
              <button
                key={s}
                onClick={() => handleStatus(s)}
                className={`text-xs px-2 py-1 rounded border ${
                  project.status === s
                    ? "border-sky-500 bg-sky-50 text-sky-700"
                    : "border-gray-300 text-gray-500 hover:bg-white"
                }`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Materials needed (comma separated)
            </label>
            <input
              value={materials}
              onChange={(e) => setMaterials(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">
                Next step
              </label>
              <input
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                placeholder="e.g. Reset posts, panels already bought"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div className="w-36">
              <label className="block text-xs text-gray-400 mb-1">
                Wait until
              </label>
              <input
                type="date"
                value={nextStepDate}
                onChange={(e) => setNextStepDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={handleDelete}
              className="text-xs text-gray-400 hover:text-red-600"
            >
              Delete project
            </button>
            <div className="flex items-center gap-2">
              {saved && <span className="text-xs text-green-600">Saved ✓</span>}
              <button
                onClick={handleSave}
                className="text-xs bg-sky-600 hover:bg-sky-700 text-white font-semibold px-3 py-1.5 rounded-lg"
              >
                Save details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
