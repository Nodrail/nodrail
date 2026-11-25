import type { Tour } from "./tours";

/** Tours of the screens where a team sets Nodrail up: policies, agents, settings. */
export const setupTours = {
  policies: {
    label: "Policies",
    steps: [
      {
        anchor: "policies-rules",
        title: "Rules allow or deny.",
        body: "Each rule allows or denies an agent's action on a resource. An action no rule covers is denied.",
      },
      {
        anchor: "policies-tab-gates",
        title: "Gates wait for earlier steps.",
        body: "A gate denies an action until earlier steps of the run pass, such as QA before a pull request. The agent is told what is missing.",
      },
      {
        anchor: "policies-tab-budgets",
        title: "Budgets cap a step or a run.",
        body: "A budget limits tool calls, tokens or spend. Once it is used up, further actions are denied.",
      },
      {
        anchor: "policies-tab-yaml",
        title: "The same rules as one YAML file.",
        body: "Edit them as text: the file is checked as you type, and you review what changes before it goes live.",
      },
      {
        anchor: "policies-actions",
        title: "Add rules one by one or in bulk.",
        body: "Write a rule in a form with New rule. More imports or exports the YAML file, and copies these policies to another environment for review.",
      },
    ],
  },
  "policies-yaml": {
    label: "Policies as YAML",
    steps: [
      {
        anchor: "yaml-editor",
        title: "Every rule in one file.",
        body: "The rules, gates and budgets of this environment, as YAML you can edit like any text.",
      },
      {
        anchor: "yaml-problems",
        title: "Problems show as you type.",
        body: "Each one names its line; choose it to jump there. Review stays off until the errors are fixed.",
      },
      {
        anchor: "yaml-review",
        title: "Review, then publish.",
        body: "Review compares the file with the live rules. Nothing changes until you publish, and rules left out of the file are removed.",
      },
    ],
  },
  rule: {
    label: "Rule",
    steps: [
      {
        anchor: "rule-decision",
        title: "Allow or deny.",
        body: "The decision is what happens when a call matches: it runs, or it is denied with the rule's name. Nothing waits for a person.",
      },
      {
        anchor: "rule-scope",
        title: "Keep the scope narrow.",
        body: "Choose the agent, installation, operation and resource. Conditions narrow it further by what the agent sends.",
      },
      {
        anchor: "rule-environment",
        title: "One environment at a time.",
        body: "A rule applies only in the environment it was written in. Switch environment to write rules for another.",
      },
    ],
  },
  "run-policy": {
    label: "Gate or budget",
    steps: [
      {
        anchor: "run-policy-entry",
        title: "Gates and budgets only deny.",
        body: "While a gate's steps haven't passed, or a budget is used up, the action is denied with what is missing. They never allow anything your rules don't.",
      },
      {
        anchor: "run-policy-requires",
        title: "Name the steps that must pass.",
        body: "Each step agent must report one of the verdicts after the last change. List agents under After work by to ask for a fresh check once they work again.",
      },
      {
        anchor: "rule-environment",
        title: "One environment at a time.",
        body: "Saving publishes a new policy version for this environment only. The YAML tab shows the same entry as text.",
      },
    ],
  },
  agents: {
    label: "Agents",
    steps: [
      {
        anchor: "agents-list",
        title: "Every agent in this environment.",
        body: "Each row shows its access and its last check-in. Open one to see everything about it.",
      },
      {
        anchor: "agents-status",
        title: "Connected and reporting.",
        body: "Connected agents have a credential for this control plane. Reporting ones checked in recently from their host.",
      },
      {
        anchor: "agents-connect",
        title: "Connect another agent.",
        body: "Give it an ID and a credential, then run nodrail apply with a connect: block that points here.",
      },
    ],
  },
  agent: {
    label: "Agent",
    steps: [
      {
        anchor: "agent-status",
        title: "How it stands, at a glance.",
        body: "Whether its host checked in recently, and whether someone paused it.",
      },
      {
        anchor: "agent-tabs",
        title: "Operations, rules, runs and settings.",
        body: "The operations it asks for, the work it took part in and how it is connected, each on its own tab. Every event is in Activity.",
      },
      {
        anchor: "agent-tab-rules",
        title: "The rules that apply to it.",
        body: "Rules written for this agent and rules for every agent. Anything they don't cover is denied.",
      },
      {
        anchor: "agent-tab-settings",
        title: "Its connection, and pausing it.",
        body: "Settings has its credential and who can see it. Pausing it, at the bottom, denies its covered calls until you resume it.",
      },
    ],
  },
  connect: {
    label: "Connect an agent",
    steps: [
      {
        anchor: "connect-runtime",
        title: "Pick its host.",
        body: "Choose Claude Code, Codex, Copilot or your own code. The setup steps that follow are written for it.",
      },
      {
        anchor: "connect-identity",
        title: "Give it a stable ID.",
        body: "Use the same ID in the agent's configuration. Its rules and activity are listed under it.",
      },
      {
        anchor: "connect-submit",
        title: "Connect, then install.",
        body: "The credential is shown once, with the nodrail.yaml block and the nodrail apply to run. This page shows the agent's first check-in as it happens, and the checks to run tick themselves as its decisions show them.",
      },
    ],
  },
  settings: {
    label: "Workspace settings",
    steps: [
      {
        anchor: "settings-nav",
        title: "Settings for the whole workspace.",
        body: "These pages apply to every environment. Open them any time from the workspace menu, top left.",
      },
      {
        anchor: "settings-general",
        title: "Name it and choose where it opens.",
        body: "Rename the workspace, and pick the environment people land in.",
      },
      {
        anchor: "settings-members",
        title: "Invite people and set their roles.",
        body: "A role decides what someone can change or only see. Viewers see the agents assigned to them.",
      },
      {
        anchor: "settings-billing",
        title: "Your plan and this month's usage.",
        body: "See how many agent actions are left before the reset. On Nodrail Cloud, upgrade or manage payment here.",
      },
    ],
  },
  account: {
    label: "Your account",
    steps: [
      {
        anchor: "account-nav",
        title: "Your own choices in this workspace.",
        body: "They change nothing for anyone else. Open them any time from your avatar, top right.",
      },
      {
        anchor: "account-notifications",
        title: "Choose your emails.",
        body: "Pick which events in this workspace send you an email, such as an integration that stopped reporting.",
      },
      {
        anchor: "account-tokens",
        title: "Tokens for the API, CLI and MCP.",
        body: "A token acts as you, with the scopes you give it, and never does more than your role allows.",
      },
      {
        anchor: "account-privacy",
        title: "Cookies and your data.",
        body: "Change your cookie choices, or delete your account and what Nodrail keeps about you.",
      },
    ],
  },
  import: {
    label: "Import rules",
    steps: [
      {
        anchor: "import-file",
        title: "Bring a whole rules file.",
        body: "Upload a YAML file or paste it. The rules in this environment will match the file exactly.",
      },
      {
        anchor: "import-check",
        title: "Preview before anything changes.",
        body: "Nodrail checks the file and lists every problem with its line, before anything is published.",
      },
      {
        anchor: "import-preview",
        title: "See what will change, then apply.",
        body: "Rules to add, change and remove are listed. Rules not in the file are removed, so read the list before you apply it.",
      },
    ],
  },
} satisfies Record<string, Tour>;
