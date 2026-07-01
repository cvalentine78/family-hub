import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFamily } from "@/lib/family";
import Nav from "../Nav";
import ProjectsBoard from "./ProjectsBoard";
import type { Project, ProjectTask } from "./ProjectsBoard";

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const family = await getCurrentFamily();
  if (!family) redirect("/app");

  const { data: projects } = await supabase
    .from("projects")
    .select(
      "id, category, name, status, notes, materials, next_step, next_step_date, created_by, created_at"
    )
    .eq("family_id", family.id);

  const { data: tasks } = await supabase
    .from("project_tasks")
    .select("id, project_id, text, is_checked, created_by, created_at")
    .eq("family_id", family.id);

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Projects</h1>
          <p className="text-sm text-gray-500">{family.name}</p>
        </div>
        <Nav />
      </div>

      <ProjectsBoard
        familyId={family.id}
        initialProjects={(projects as Project[]) ?? []}
        initialTasks={(tasks as ProjectTask[]) ?? []}
      />
    </div>
  );
}
