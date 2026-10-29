import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  DEFAULT_UNIFIED_SETTINGS,
  type ServerSettings,
  type TvDoorbellStatus,
} from "@t3tools/contracts";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { QRCodeSvg } from "../ui/qr-code";
import { ScopedSwitch } from "./ScopedSwitch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting, type SettingsSearchItemId } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type RingKey = "tvDoorbellRingOnNeedsYou" | "tvDoorbellRingOnCompleted" | "tvDoorbellRingOnFailed";

const RING_ROWS = [
  {
    key: "tvDoorbellRingOnNeedsYou",
    id: "tv-doorbell-needs-you",
    title: "Needs you",
    description: "Ring when a thread asks for approval or input.",
  },
  {
    key: "tvDoorbellRingOnCompleted",
    id: "tv-doorbell-completed",
    title: "Done",
    description: "Ring when a thread finishes its run.",
  },
  {
    key: "tvDoorbellRingOnFailed",
    id: "tv-doorbell-failed",
    title: "Failed",
    description: "Ring when a thread's run fails.",
  },
] as const satisfies ReadonlyArray<{
  key: RingKey;
  id: SettingsSearchItemId;
  title: string;
  description: string;
}>;

/** Apple TV surfaces: the HomeKit doorbell that rings over whatever is playing. */
export function TvSettingsPanel() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const canManage = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const status = useEnvironmentQuery(
    environmentId === null || !canManage || !settings.tvDoorbellEnabled
      ? null
      : serverEnvironment.tvDoorbellStatus({ environmentId, input: {} }),
  ).data;

  return (
    <SettingsPageContainer>
      <SettingsSection id="tv-doorbell" title="Apple TV doorbell">
        <SettingsRow
          serverScoped
          {...searchableSetting("tv-doorbell")}
          settingKeys={["tvDoorbellEnabled"]}
          description="Adds a HomeKit doorbell named T3 Code. When a thread needs you, finishes, or fails, Apple TV shows a picture-in-picture card over whatever is playing. This machine and the Apple TV must be on the same network."
          status={status ? <DoorbellStateBadge status={status} /> : null}
          control={
            <ScopedSwitch
              settingKeys={["tvDoorbellEnabled"]}
              checked={settings.tvDoorbellEnabled}
              onCheckedChange={(checked) => updateSettings({ tvDoorbellEnabled: Boolean(checked) })}
              aria-label="Apple TV doorbell"
            />
          }
        />
        {settings.tvDoorbellEnabled && status && environmentId !== null ? (
          <DoorbellPairingRows environmentId={environmentId} status={status} />
        ) : null}
      </SettingsSection>

      {settings.tvDoorbellEnabled ? (
        <SettingsSection id="tv-doorbell-rings" title="Ring when">
          {RING_ROWS.map((row) => (
            <RingToggleRow key={row.key} row={row} settings={settings} update={updateSettings} />
          ))}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}

function DoorbellStateBadge({ status }: { status: TvDoorbellStatus }) {
  if (status.state === "unavailable") return <Badge variant="error">Unavailable</Badge>;
  if (status.state !== "ready") return <Badge variant="secondary">Starting</Badge>;
  return status.paired ? (
    <Badge variant="success">Paired</Badge>
  ) : (
    <Badge variant="warning">Not paired</Badge>
  );
}

function DoorbellPairingRows({
  environmentId,
  status,
}: {
  environmentId: NonNullable<ReturnType<typeof useSettingsScope>["environment"]>["environmentId"];
  status: TvDoorbellStatus;
}) {
  const testRing = useAtomCommand(serverEnvironment.tvDoorbellTestRing);
  const resetPairing = useAtomCommand(serverEnvironment.tvDoorbellResetPairing);
  const canTestRing = useAtomValue(
    serverEnvironment.tvDoorbellTestRing.permissionAtom(environmentId),
  );
  const canResetPairing = useAtomValue(
    serverEnvironment.tvDoorbellResetPairing.permissionAtom(environmentId),
  );

  if (status.state === "unavailable") {
    return (
      <SettingsRow
        title="Doorbell unavailable"
        description={status.message ?? "The doorbell could not start on this machine."}
      />
    );
  }

  return (
    <>
      {!status.paired && status.setupCode && status.setupUri ? (
        <SettingsRow
          title="Add to the Home app"
          description={
            <>
              On an iPhone in the same Home as your Apple TV, open Home, tap Add Accessory, and scan
              this code. Or choose More options, pick {status.accessoryName}, and enter{" "}
              <span className="font-mono text-foreground">{status.setupCode}</span>. Home warns that
              the accessory is uncertified; add it anyway.
            </>
          }
          control={
            <div className="rounded-lg bg-white p-1.5">
              <QRCodeSvg
                value={status.setupUri}
                size={112}
                level="M"
                marginSize={1}
                title="HomeKit setup code"
              />
            </div>
          }
        />
      ) : null}
      <SettingsRow
        {...searchableSetting("tv-doorbell-test")}
        description={
          status.lastRing
            ? `Last ring: ${status.lastRing.threadTitle}, ${new Date(status.lastRing.at).toLocaleTimeString()}.`
            : "Rings the doorbell now with a sample card."
        }
        control={
          <Button
            size="sm"
            variant="outline"
            disabled={!status.paired || !canTestRing}
            onClick={() => void testRing({ environmentId, input: {} })}
          >
            Test ring
          </Button>
        }
      />
      {status.paired ? (
        <SettingsRow
          {...searchableSetting("tv-doorbell-reset")}
          description="Forget the current pairing and show a new setup code. Remove the old T3 Code doorbell from the Home app too."
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!canResetPairing}
              onClick={() => void resetPairing({ environmentId, input: {} })}
            >
              Reset pairing
            </Button>
          }
        />
      ) : null}
    </>
  );
}

function RingToggleRow({
  row,
  settings,
  update,
}: {
  row: (typeof RING_ROWS)[number];
  settings: Pick<ServerSettings, RingKey>;
  update: ReturnType<typeof useUpdateScopedSettings>;
}) {
  const changed = settings[row.key] !== DEFAULT_UNIFIED_SETTINGS[row.key];
  return (
    <SettingsRow
      serverScoped
      {...searchableSetting(row.id)}
      settingKeys={[row.key]}
      description={row.description}
      resetAction={
        changed ? (
          <SettingResetButton
            label={row.title.toLowerCase()}
            onClick={() => update({ [row.key]: DEFAULT_UNIFIED_SETTINGS[row.key] })}
          />
        ) : null
      }
      control={
        <ScopedSwitch
          settingKeys={[row.key]}
          checked={settings[row.key]}
          onCheckedChange={(checked) => update({ [row.key]: Boolean(checked) })}
          aria-label={row.title}
        />
      }
    />
  );
}
