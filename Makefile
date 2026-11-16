# One command runs the whole gate (build-game convention).
test:
	bunx oxfmt --check
	bunx oxlint --deny-warnings
	bun run typecheck
	bun run test

.PHONY: test
