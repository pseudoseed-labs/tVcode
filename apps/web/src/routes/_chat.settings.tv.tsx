import { createFileRoute } from "@tanstack/react-router";

import { TvSettingsPanel } from "../components/settings/TvSettingsPanel";

export const Route = createFileRoute("/_chat/settings/tv")({ component: TvSettingsPanel });
