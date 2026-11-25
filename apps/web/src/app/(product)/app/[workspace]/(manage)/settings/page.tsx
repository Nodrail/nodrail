import { redirect } from "next/navigation";
import { settingsPath } from "@/features/shell/navigation";

export default async function SettingsEntry({
  params,
}: PageProps<"/app/[workspace]/settings">) {
  redirect(settingsPath((await params).workspace, "general"));
}
