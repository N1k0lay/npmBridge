PROD_HOST   = npm@repo.dmn.zbr
PROD_DIR    = /home/npm/npmBridge

.PHONY: help deploy build restart logs status ssh \
        rollback stop start

# ─────────────────────────────────────────────
# По умолчанию — справка
# ─────────────────────────────────────────────
help:
	@echo ""
	@echo "  npmBridge — команды деплоя"
	@echo ""
	@echo "  make deploy     Полный деплой: git pull + build + restart webapp"
	@echo "  make build      Пересборка образа webapp на проде"
	@echo "  make restart    Перезапуск webapp"
	@echo "  make stop       Остановить webapp"
	@echo "  make start      Запустить webapp"
	@echo "  make logs       Логи webapp (follow)"
	@echo "  make status     Статус всех контейнеров"
	@echo "  make ssh        Открыть сессию на проде"
	@echo ""

# ─────────────────────────────────────────────
# deploy: git pull → build → restart
# ─────────────────────────────────────────────
deploy:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && \
		git pull && \
		docker compose build webapp && \
		docker compose up -d webapp && \
		docker compose logs webapp --tail=30"

# ─────────────────────────────────────────────
# Управление контейнерами
# ─────────────────────────────────────────────
build:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose build webapp"

restart:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose restart webapp"

stop:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose stop webapp"

start:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose up -d webapp"

# ─────────────────────────────────────────────
# Мониторинг
# ─────────────────────────────────────────────
logs:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose logs webapp -f --tail=100"

status:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose ps"

# ─────────────────────────────────────────────
# SSH сессия
# ─────────────────────────────────────────────
ssh:
	ssh $(PROD_HOST)
