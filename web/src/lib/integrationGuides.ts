import { serviceGuide, serviceTutorial } from "./serviceGuides";

/**
 * The content behind the Integration Center's easy setup: provider cards, the Connect wizards and the step-by-step tutorials.
 * Plain data only: no secrets, no code paths. Links are the providers' OFFICIAL pages (never search results), as supplied by the owner on
 * 2026-11-04. Provider pages change over time; the wording says what to look for rather than describing exact screens.
 */

export interface GuideLink {
  label: string;
  href: string;
}

export interface TutorialStep {
  title: string;
  /** Short paragraphs, plain words. */
  text: string[];
  /** Numbered instructions for this step. */
  numbered?: string[];
  links?: GuideLink[];
  /** Values the user may need to type somewhere else, each with a Copy button. */
  copy?: { label: string; value: string }[];
  /** An in-app page that does this step. */
  appLink?: { label: string; to: string };
}

export interface Tutorial {
  id: string;
  title: string;
  /** One line under the title. */
  summary: string;
  steps: TutorialStep[];
  troubleshooting: { problem: string; fix: string }[];
}

export type ProviderId = "gemini" | "groq" | "openrouter" | "ollama";

export interface ProviderGuide {
  id: ProviderId;
  name: string;
  /** Two letters for the badge; official logos are not bundled (no downloads, no trademarks copied). */
  mark: string;
  /** Tailwind classes for the badge colours. */
  markTone: string;
  description: string;
  offers: string[];
  difficulty: "Easy" | "Moderate";
  keyRequired: boolean;
  runs: "internet" | "local";
  links: { website: string; keys?: string; docs: string; download?: string; library?: string };
  /** What a key looks like, to catch an obvious paste mistake. Only a warning: formats can change. */
  keyPrefix?: string;
  keyExample?: string;
  /** What the person needs before starting. */
  needs: string[];
  /** Instructions for getting the key (cloud) - shown in the wizard and the tutorial. */
  keySteps?: string[];
  freeNote: string;
  tutorial: Tutorial;
}

const OLLAMA_ADDRESS = "http://localhost:11434";
export const OLLAMA_DEFAULT_ADDRESS = OLLAMA_ADDRESS;
/** Small models that run on an ordinary laptop. Sizes are approximate download sizes. */
export const OLLAMA_STARTER_MODELS = [
  { id: "llama3.2:3b", size: "about 2 GB", note: "Good first model for most PCs" },
  { id: "llama3.1:8b", size: "about 5 GB", note: "Better answers, needs about 8 GB of free memory" },
];

const cloudKeyTroubleshooting = (name: string, keysUrl: string) => [
  { problem: "The test says the key was rejected", fix: `Copy the key again from ${keysUrl}, with no spaces before or after it, and paste it in again. A deleted or expired key must be replaced with a new one.` },
  { problem: "The test says the provider could not be reached", fix: "Check your internet connection, then press Test connection again. Outside actions must not be paused in Approvals." },
  { problem: "It says too many requests", fix: `${name}'s free plan has limits per minute and per day. Wait a few minutes. This app also has its own daily safety cap, shown on the provider card.` },
  { problem: "No models appear", fix: "Press Find models again. Only free models are shown as usable; paid models are never used by this app." },
];

export const PROVIDER_GUIDES: ProviderGuide[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    mark: "Ge",
    markTone: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    description: "Google's AI models, with a free plan through Google AI Studio.",
    offers: ["Strong general-purpose models", "Long documents", "Free plan with daily limits"],
    difficulty: "Easy",
    keyRequired: true,
    runs: "internet",
    links: { website: "https://aistudio.google.com/", keys: "https://aistudio.google.com/app/apikey", docs: "https://ai.google.dev/gemini-api/docs/get-started" },
    keyPrefix: "AIza",
    keyExample: "AIza…",
    needs: ["A Google account", "About 5 minutes", "No payment card: use a Google Cloud project with no billing attached"],
    keySteps: ["Sign in with your Google account.", "Open the API keys page.", "Create an API key.", "Copy the key.", "Return to AI Workforce and paste it."],
    freeNote: "Free plan only. On the free plan Google may use your prompts to improve its products, so do not send private data. This app never turns on billing.",
    tutorial: {
      id: "gemini",
      title: "Connect Google Gemini",
      summary: "Get a free key from Google AI Studio and connect it.",
      steps: [
        { title: "What you are setting up", text: ["Gemini is Google's family of AI models. With a free key from Google AI Studio, your bots can use them.", "You need a Google account. You do not need a payment card."] },
        { title: "Open Google AI Studio", text: ["Open AI Studio and sign in with your Google account. Accept the terms if asked."], links: [{ label: "Open Google AI Studio", href: "https://aistudio.google.com/" }] },
        {
          title: "Create your API key",
          text: ["An API key is a password that lets this app use Gemini for you. Keep it private."],
          numbered: ["Sign in.", "Open the API keys page (button below).", "Choose Create API key. If it asks for a project, let it create a new one.", "Copy the key (it starts with AIza).", "Return to AI Workforce."],
          links: [{ label: "Open the API keys page", href: "https://aistudio.google.com/app/apikey" }],
        },
        { title: "Make sure billing is off", text: ["The free plan has no billing. Do not add a payment method to the project that holds this key. The wizard asks you to confirm this before connecting."] },
        { title: "Connect it here", text: ["In AI Workforce, open Integrations Center, press Connect on Google Gemini, and paste the key. It is stored encrypted on this PC and is never shown again."], appLink: { label: "Start the Gemini wizard", to: "/integrations/connect/gemini" } },
        { title: "Test and choose models", text: ["The wizard tests the connection, then finds the available models. Tick the ones your bots may use. Done."] },
      ],
      troubleshooting: cloudKeyTroubleshooting("Gemini", "aistudio.google.com/app/apikey"),
    },
  },
  {
    id: "groq",
    name: "Groq",
    mark: "Gq",
    markTone: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
    description: "Very fast answers from open models (Llama, Qwen and others), with a free plan.",
    offers: ["Very fast replies", "Open models such as Llama", "Free plan with limits"],
    difficulty: "Easy",
    keyRequired: true,
    runs: "internet",
    links: { website: "https://groq.com/", keys: "https://console.groq.com/keys", docs: "https://console.groq.com/docs/quickstart" },
    keyPrefix: "gsk_",
    keyExample: "gsk_…",
    needs: ["An email address or Google/GitHub account to sign up", "About 5 minutes", "No payment card"],
    keySteps: ["Sign in to the Groq console.", "Open the API Keys page.", "Create an API key and give it a name such as AI Workforce.", "Copy the key (it is shown only once).", "Return to AI Workforce and paste it."],
    freeNote: "Free plan only. Do not upgrade to a paid plan for this app; it never uses paid models.",
    tutorial: {
      id: "groq",
      title: "Connect Groq",
      summary: "Create a free Groq account and key, then connect it.",
      steps: [
        { title: "What you are setting up", text: ["Groq runs open AI models very quickly. A free key lets your bots use them."] },
        { title: "Create an account", text: ["Open the Groq console and sign up or sign in."], links: [{ label: "Open the Groq website", href: "https://groq.com/" }, { label: "Open the Groq console keys page", href: "https://console.groq.com/keys" }] },
        {
          title: "Create your API key",
          text: ["The key is shown only once, so copy it straight away."],
          numbered: ["Sign in to the console.", "Open API Keys.", "Choose Create API Key and name it AI Workforce.", "Copy the key (it starts with gsk_).", "Return to AI Workforce."],
          links: [{ label: "Open the API keys page", href: "https://console.groq.com/keys" }],
        },
        { title: "Stay on the free plan", text: ["Do not add a payment method. The wizard asks you to confirm the account has no billing."] },
        { title: "Connect it here", text: ["Press Connect on the Groq card and paste the key."], appLink: { label: "Start the Groq wizard", to: "/integrations/connect/groq" } },
        { title: "Test and choose models", text: ["Test the connection, let the app find the models, and tick the ones your bots may use."] },
      ],
      troubleshooting: cloudKeyTroubleshooting("Groq", "console.groq.com/keys"),
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    mark: "OR",
    markTone: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    description: "One key for many AI models from different companies. Some models are free.",
    offers: ["Many models with one key", "Free models (marked :free)", "Easy to compare models"],
    difficulty: "Easy",
    keyRequired: true,
    runs: "internet",
    links: { website: "https://openrouter.ai/", keys: "https://openrouter.ai/keys", docs: "https://openrouter.ai/docs/quickstart" },
    keyPrefix: "sk-or-",
    keyExample: "sk-or-…",
    needs: ["An email address or Google/GitHub account", "About 5 minutes", "No payment: only free models are used"],
    keySteps: ["Sign in to OpenRouter.", "Open the Keys page.", "Create a key named AI Workforce.", "Copy the key (shown only once).", "Return to AI Workforce and paste it."],
    freeNote: "Only models with a price of exactly zero are used. Paid models stay blocked even if your account has credits. You do not need to buy credits.",
    tutorial: {
      id: "openrouter",
      title: "Connect OpenRouter",
      summary: "Create a free OpenRouter key and connect it. Only free models are used.",
      steps: [
        { title: "What you are setting up", text: ["OpenRouter gives access to many AI models through one key. This app uses only its free models."] },
        { title: "Create an account", text: ["Open OpenRouter and sign up or sign in."], links: [{ label: "Open OpenRouter", href: "https://openrouter.ai/" }] },
        {
          title: "Create your API key",
          text: ["Copy the key straight away: it is shown only once."],
          numbered: ["Sign in.", "Open the Keys page.", "Choose Create Key and name it AI Workforce.", "Copy the key (it starts with sk-or-).", "Return to AI Workforce."],
          links: [{ label: "Open the keys page", href: "https://openrouter.ai/keys" }],
        },
        { title: "No credits needed", text: ["You do not need to buy credits. Free models have a price of zero; the app refuses every model that has a price."] },
        { title: "Connect it here", text: ["Press Connect on the OpenRouter card and paste the key."], appLink: { label: "Start the OpenRouter wizard", to: "/integrations/connect/openrouter" } },
        { title: "Test and choose models", text: ["Test the connection, find the models, and tick the free ones your bots may use."] },
      ],
      troubleshooting: cloudKeyTroubleshooting("OpenRouter", "openrouter.ai/keys"),
    },
  },
  {
    id: "ollama",
    name: "Ollama (on this PC)",
    mark: "Ol",
    markTone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    description: "Runs AI models on your own computer. Free, private, works without internet once a model is downloaded.",
    offers: ["Private: nothing leaves your PC", "No account and no key", "Works offline after setup"],
    difficulty: "Moderate",
    keyRequired: false,
    runs: "local",
    links: { website: "https://ollama.com/", download: "https://ollama.com/download/windows", library: "https://ollama.com/library", docs: "https://docs.ollama.com/" },
    needs: ["A Windows PC with a few GB of free disk space", "About 15 minutes, mostly downloading", "Models run slower than cloud ones on a laptop"],
    freeNote: "Local models are free and private. Ollama can also list 'cloud' models (names ending in cloud) that run on Ollama's servers and are billed: this app never uses them.",
    tutorial: {
      id: "ollama",
      title: "Install and connect Ollama",
      summary: "Install Ollama on Windows, download one small model, and connect it.",
      steps: [
        { title: "What you are setting up", text: ["Ollama is a free program that runs AI models on this PC. Nothing you type leaves your computer.", "It is slower than cloud models on a laptop, so it works best as a private backup."] },
        { title: "Download Ollama for Windows", text: ["Download the installer from the official site. AI Workforce never installs it for you."], links: [{ label: "Download Ollama for Windows", href: "https://ollama.com/download/windows" }] },
        { title: "Install it", text: ["Run the downloaded file (OllamaSetup.exe) and follow the installer. Windows may ask for permission: that is your decision."], numbered: ["Open your Downloads folder.", "Double-click OllamaSetup.exe.", "Choose Install and wait until it finishes."] },
        { title: "Start Ollama", text: ["After installing, Ollama starts by itself and shows a small llama icon near the clock. If it is not running, open Ollama from the Start menu.", "It listens only on this PC at the address below."], copy: [{ label: "Ollama's address", value: OLLAMA_ADDRESS }] },
        {
          title: "Download a small model",
          text: ["A model is the AI 'brain'. Download one small model first. It can take several minutes. AI Workforce never downloads models for you."],
          numbered: ["Open the Start menu and type PowerShell, then open Windows PowerShell.", "Copy the command below, paste it into PowerShell and press Enter.", "Wait until it says success."],
          copy: [{ label: "Download command (about 2 GB)", value: "ollama pull llama3.2:3b" }, { label: "See downloaded models", value: "ollama list" }],
          links: [{ label: "Browse the model library", href: "https://ollama.com/library" }],
        },
        { title: "Connect it here", text: ["Open the Ollama wizard. It checks that Ollama is running, finds your downloaded models and lets you send a test message."], appLink: { label: "Start the Ollama wizard", to: "/integrations/connect/ollama" } },
      ],
      troubleshooting: [
        { problem: "The wizard says Ollama is not running", fix: "Open Ollama from the Start menu and wait a few seconds; the wizard checks again by itself. A restart of the PC also starts it." },
        { problem: "'ollama' is not recognized in PowerShell", fix: "Close PowerShell and open it again after installing. If it still fails, restart the PC." },
        { problem: "No models are found", fix: "Download one first with: ollama pull llama3.2:3b. Then press Find models again." },
        { problem: "Answers are very slow", fix: "Use the smallest model (llama3.2:3b) and close other heavy programs. Local models are slower than cloud ones on a laptop." },
        { problem: "A model shows as billed or blocked", fix: "Models whose names end in cloud run on Ollama's servers and are billed. This app never uses them; download a local model instead." },
      ],
    },
  },
];

export const providerGuide = (id: string | undefined) => PROVIDER_GUIDES.find((g) => g.id === id);

/** Other integrations: the same step-by-step format, pointing at the pages that already do the work. */
export const OTHER_TUTORIALS: (Tutorial & { mark: string; what: string })[] = [
  {
    id: "desktop-apps",
    mark: "Ap",
    title: "Let bots use a desktop program",
    what: "Bots can operate a program you approve, one step at a time, after you approve each plan.",
    summary: "Approve one program, then a bot can ask to use it. Every plan waits for your approval.",
    steps: [
      { title: "What it does", text: ["A bot can open a program you approved, click, type and read from it, using Windows' own accessibility features.", "It only uses windows it opened itself. It never touches windows you already have open."] },
      { title: "What you need", text: ["The program installed on this PC, and a bot that is switched on with the PC agent's permission to run."] },
      { title: "Find and approve the program", text: ["Open Access, go to Applications and press Scan applications (read-only): it only reads the list of installed programs. Find the program and press Approve…"], appLink: { label: "Open Access", to: "/access" } },
      { title: "Give it folders if it saves files", text: ["If the program opens or saves files, also approve the folder it may use (see the File access guide). Approving a program never gives it your files."] },
      { title: "Test it", text: ["Ask the bot for a small task with that program. A plan appears on the Approvals page; read every step, then approve. The result appears in the task."], appLink: { label: "Open Approvals", to: "/approvals" } },
      { title: "Disconnect", text: ["In Access, open the program and choose Take back. It stops at the next step, even mid-task."] },
    ],
    troubleshooting: [
      { problem: "The bot says the program is not approved", fix: "Approve it under Access > Applications. Protected programs (security, banking, system tools) cannot be approved." },
      { problem: "It stopped in the middle", fix: "A revoke, the Guardian pause or an unexpected dialog stops it on purpose. The task explains which." },
    ],
  },
  {
    id: "file-access",
    mark: "Fi",
    title: "Let bots read or write files",
    what: "Give a bot one folder, with exactly the actions you choose (read, create, edit, rename, delete).",
    summary: "Folders are closed by default. Approve one folder and choose what may be done in it.",
    steps: [
      { title: "What it does", text: ["Bots can only touch files in folders you approved, and only in the ways you ticked."] },
      { title: "What you need", text: ["A folder for the bot to work in. A new, empty folder such as Documents\\AI Workforce is safest."] },
      { title: "Approve the folder", text: ["Open Access, go to Folder access, use Approve a folder, paste the folder's full path and tick what is allowed. Start with read and create only."], appLink: { label: "Open Access", to: "/access" } },
      { title: "Test it", text: ["Ask a bot to create a small text file there. Writing waits for your approval; the file appears after you approve."] },
      { title: "Disconnect", text: ["Press Take back on the approved folder. It takes effect immediately, even for a task already running."] },
    ],
    troubleshooting: [
      { problem: "Access denied", fix: "Check the folder is approved and the action (for example edit) is ticked. Sub-folders are included only if you chose that." },
      { problem: "It refuses a folder with passwords or keys", fix: "Folders that look like they hold secrets need a separate, short-lived approval on purpose." },
    ],
  },
  {
    id: "webhooks",
    mark: "Wh",
    title: "Start bots from other apps (webhooks and events)",
    what: "Another program can send an event that starts a bot's task, using triggers you define.",
    summary: "Create a trigger, then send an event to start it. Nothing runs while automation is paused.",
    steps: [
      { title: "What it does", text: ["A trigger watches for an event name and starts a task for a chosen bot. Events can come from this PC or from inbound messages you set up."] },
      { title: "What you need", text: ["A bot that is switched on, and automation switched on in Schedules."] },
      { title: "Create a trigger", text: ["Open Schedules, go to Triggers, choose A text event arrives, give the event a name and pick the bot and instruction. New triggers start switched off: switch it on when ready."], appLink: { label: "Open Schedules", to: "/automation" } },
      { title: "Test it", text: ["Use Send a test event on the same page. The task appears under Activity & Logs."], appLink: { label: "Open Activity & Logs", to: "/tasks" } },
      { title: "Disconnect", text: ["Switch the trigger off or delete it. Pausing automation stops all triggers at once."] },
    ],
    troubleshooting: [
      { problem: "Nothing happens", fix: "Automation may be paused, the bot may be switched off, or the Guardian may be holding. The Schedules page shows which." },
    ],
  },
  {
    id: "external-services",
    mark: "Ex",
    title: "Connect outside services (Gmail, Telegram, GitHub…)",
    what: "Bots can read from services you connect; anything that sends or changes something waits for your approval.",
    summary: "Save the service's key or sign in, test it, then allow it per bot.",
    steps: [
      { title: "What it does", text: ["Each service card in the Integrations Center shows what bots can do with it and what needs your approval."] },
      { title: "What you need", text: ["An account with the service. Each card says how you sign in (a token, an address, or Google sign-in)."] },
      { title: "Configure it", text: ["Press Connect on the service's card and follow its steps. You only ever see the boxes for that one service."], appLink: { label: "Open the Integrations Center", to: "/integrations" } },
      { title: "Test it", text: ["The wizard's Test step (or Test connection on the card) shows Verified only after a real check succeeded."] },
      { title: "Allow it for a bot", text: ["Open the bot, go to Permissions and switch reading on for that service. Sending always waits on Approvals."] },
      { title: "Disconnect", text: ["Press Disconnect on the card. The bot loses access straight away."] },
    ],
    troubleshooting: [{ problem: "Check failed", fix: "Open Details on the card: the If something goes wrong list explains the usual causes for that service." }],
  },
];

export const tutorialById = (id: string | undefined): Tutorial | undefined => {
  const svc = serviceGuide(id);
  return PROVIDER_GUIDES.find((g) => g.id === id)?.tutorial ?? OTHER_TUTORIALS.find((t) => t.id === id) ?? (svc ? serviceTutorial(svc) : undefined);
};

/** A pasted key: blocking problems (cannot be a key) and a soft warning (unexpected start). */
export function checkKey(raw: string, guide: ProviderGuide): { error: string | null; warning: string | null } {
  const key = raw.trim();
  if (!key) return { error: "Paste your key first.", warning: null };
  if (/\s/.test(key)) return { error: "The key contains a space or line break. Copy it again, without extra characters.", warning: null };
  if (key.length < 20) return { error: "That is too short to be an API key. Copy the whole key.", warning: null };
  if (key.length > 300) return { error: "That is too long to be an API key. Paste only the key.", warning: null };
  if (/^https?:/i.test(key)) return { error: "That is a web address, not a key. Copy the key itself.", warning: null };
  if (guide.keyPrefix && !key.startsWith(guide.keyPrefix)) {
    return { error: null, warning: `${guide.name} keys usually start with ${guide.keyPrefix}. Check that you copied the right thing; you can still save it.` };
  }
  return { error: null, warning: null };
}
