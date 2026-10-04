export const CORE_NAMESPACES = Object.freeze([
  "help",
  "info",
  "skills",
  "skill",
]);

export function skillNamespace(skill) {
  return skill.namespace ?? skill.name;
}

export function parseSkillCommand(content, namespace) {
  if (typeof content !== "string") return null;
  const [prefix, action, ...args] = content.trim().split(/\s+/);
  if (prefix.toLowerCase() !== `!${namespace}`) return null;
  return { command: action?.toLowerCase() || "help", args };
}
