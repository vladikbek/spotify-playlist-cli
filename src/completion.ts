import { CliError } from "./errors";

const COMMANDS = [
  "playlist",
  "account",
  "completion",
  "help"
];

const GLOBAL_FLAGS = [
  "--help",
  "--json",
  "--raw",
  "--quiet",
  "--verbose",
  "--no-color",
  "--no-input",
  "--timeout-ms",
  "--market",
  "--account"
];

function bashScript(): string {
  return `# bash completion for spm
_spm_completion() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${COMMANDS.join(" ")}" -- "$cur") )
    return 0
  fi

  if [[ "\${COMP_WORDS[1]}" == "completion" ]]; then
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
    return 0
  fi

  COMPREPLY=( $(compgen -W "${GLOBAL_FLAGS.join(" ")}" -- "$cur") )
}
complete -F _spm_completion spm
`;
}

function zshScript(): string {
  return `#compdef spm
_spm() {
  local -a commands
  commands=(${COMMANDS.join(" ")})

  if (( CURRENT == 2 )); then
    compadd -- $commands
    return
  fi

  if [[ "\${words[2]}" == "completion" && CURRENT == 3 ]]; then
    compadd -- bash zsh fish
    return
  fi

  compadd -- ${GLOBAL_FLAGS.join(" ")}
}
_spm "$@"
`;
}

function fishScript(): string {
  const lines: string[] = [
    "# fish completion for spm",
    `complete -c spm -f -a "${COMMANDS.join(" ")}"`,
    "complete -c spm -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'"
  ];
  for (const flag of GLOBAL_FLAGS) {
    lines.push(`complete -c spm -l ${flag.replace(/^--/, "")}`);
  }
  return `${lines.join("\n")}\n`;
}

export function completionScriptFor(shell: string): string {
  const normalized = shell.trim().toLowerCase();
  if (normalized === "bash") return bashScript();
  if (normalized === "zsh") return zshScript();
  if (normalized === "fish") return fishScript();
  throw new CliError("INVALID_USAGE", `Unsupported shell: ${shell}`, {
    hint: "Use one of: bash, zsh, fish."
  });
}
