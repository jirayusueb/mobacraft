export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [1, "always", ["map", "engine", "ui", "web", "repo", "deps"]],
  },
}
