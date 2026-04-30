PROD_HOST   = npm@repo.dmn.zbr
PROD_DIR    = /opt/npmBridge
RSYNC_EXCLUDES = \
	--exclude .git \
	--exclude .github \
	--exclude node_modules \
	--exclude webapp/node_modules \
	--exclude webapp/.next \
	--exclude webapp/data \
	--exclude webapp/logs \
	--exclude storage \
	--exclude frozen \
	--exclude diff_archives \
	--exclude verdaccio/storage \
	--exclude .env \
	--exclude .env.local \
	--exclude webapp/.env.local

.PHONY: help deploy build restart logs status ssh \
		rollback stop start deploy-local

# ─────────────────────────────────────────────
# По умолчанию — справка
# ─────────────────────────────────────────────
help:
	@echo ""
	@echo "  npmBridge — команды деплоя"
	@echo ""
	@echo "  make deploy     Полный деплой: git pull + build + restart webapp"
	@echo "  make deploy-local Синхронизировать текущее рабочее дерево на прод"
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
		docker compose up -d && \
		docker compose restart nginx && \
		docker compose logs webapp --tail=30"

# ─────────────────────────────────────────────
# deploy-local: rsync текущего рабочего дерева
# без git pull и без runtime-данных
# ─────────────────────────────────────────────
deploy-local:
	@set -e; \
	CHANGED="$$(rsync -azn --delete --out-format='%n' $(RSYNC_EXCLUDES) ./ $(PROD_HOST):$(PROD_DIR)/ | sed '/^$$/d')"; \
	if [ -z "$$CHANGED" ]; then \
		echo "Нет локальных изменений для отправки"; \
		exit 0; \
	fi; \
	echo "Файлы для синхронизации:"; \
	printf '%s\n' "$$CHANGED"; \
	rsync -az --delete $(RSYNC_EXCLUDES) ./ $(PROD_HOST):$(PROD_DIR)/; \
	NEED_WEBAPP=0; \
	NEED_NGINX=0; \
	NEED_VERDACCIO=0; \
	printf '%s\n' "$$CHANGED" | grep -Eq '^(deleting )?webapp/' && NEED_WEBAPP=1 || true; \
	printf '%s\n' "$$CHANGED" | grep -Eq '^(deleting )?nginx/' && NEED_NGINX=1 || true; \
	printf '%s\n' "$$CHANGED" | grep -Eq '^(deleting )?verdaccio/' && NEED_VERDACCIO=1 || true; \
	printf '%s\n' "$$CHANGED" | grep -Eq '^(deleting )?docker-compose.yml$$' && NEED_WEBAPP=1 && NEED_NGINX=1 && NEED_VERDACCIO=1 || true; \
	ssh $(PROD_HOST) 'set -e; cd $(PROD_DIR); \
		NEED_WEBAPP='"$$NEED_WEBAPP"'; \
		NEED_NGINX='"$$NEED_NGINX"'; \
		NEED_VERDACCIO='"$$NEED_VERDACCIO"'; \
		if [ "$$NEED_WEBAPP" -eq 1 ]; then \
			echo "[prod] build webapp"; \
			docker compose build webapp; \
			echo "[prod] up webapp"; \
			docker compose up -d webapp; \
		fi; \
		if [ "$$NEED_VERDACCIO" -eq 1 ]; then \
			echo "[prod] up verdaccio"; \
			docker compose up -d verdaccio; \
		fi; \
		if [ "$$NEED_NGINX" -eq 1 ]; then \
			echo "[prod] up nginx"; \
			docker compose up -d nginx; \
		fi; \
		echo "[prod] status"; \
		docker compose ps; \
		if [ "$$NEED_WEBAPP" -eq 1 ] || [ "$$NEED_NGINX" -eq 1 ]; then \
			echo "[prod] http check"; \
			curl -I -sS http://localhost:8013/ | head -n 5; \
		fi'

# ─────────────────────────────────────────────
# Управление контейнерами
# ─────────────────────────────────────────────
build:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose build webapp"

restart:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose restart webapp"

stop:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose down"

start:
	ssh $(PROD_HOST) "cd $(PROD_DIR) && docker compose up -d"

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
