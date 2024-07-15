export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [message => message.startsWith("chore(deps")],
  rules: {
    "subject-case": [2, "always", ["sentence-case"]],
  },
};
