# voxeled — task runner. Node >=18, no build step, no dependencies.
# `make` with no target prints help. Override the port with e.g. `make grid PORT=9000`.
PORT ?= 8080
NODE := node
RUN  := examples/mobius-heart/run.mjs

.DEFAULT_GOAL := help
.PHONY: help demo grid facing test map stop restart clean

help: ## Show this help
	@echo "voxeled — targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "vars: PORT=$(PORT)   ARGS=... (for map)"

demo: ## Run the demo — default two-hearts layout (http://localhost:8080)
	PORT=$(PORT) $(NODE) $(RUN)

grid: ## Run the 3x3 heart matrix
	PORT=$(PORT) $(NODE) $(RUN) examples/mobius-heart/layouts/grid-3x3.yaml

facing: ## Run the 4 facing hearts (per-instance rotation)
	PORT=$(PORT) $(NODE) $(RUN) examples/mobius-heart/layouts/facing-hearts.yaml

test: ## Run the full test suite (logic + headless-Chrome render gate)
	$(NODE) test/run.mjs

map: ## Generate a scene file from the mapper — e.g. make map ARGS="--hearts 3 --pitch 8"
	$(NODE) examples/mobius-heart/map.mjs $(ARGS)

stop: ## Free the demo port (kills whatever holds PORT)
	@fuser -k $(PORT)/tcp 2>/dev/null || lsof -ti tcp:$(PORT) | xargs -r kill 2>/dev/null || true
	@echo "freed port $(PORT)"

restart: stop demo ## Free the port, then run the default demo

clean: ## Remove generated artifacts (scenes, test screenshots)
	rm -rf test/artifacts
	rm -f examples/mobius-heart/*.vxl.json
	@echo "cleaned"
