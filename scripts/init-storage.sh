#!/bin/sh
# Скрипт инициализации прав доступа для storage
# Запускается перед verdaccio для исправления прав

STORAGE_DIR="${STORAGE_DIR:-/verdaccio/storage}"
VERDACCIO_UID="${VERDACCIO_UID:-10001}"
VERDACCIO_GID="${VERDACCIO_GID:-65533}"

echo "=== Storage permissions initialization ==="
echo "Storage dir: $STORAGE_DIR"
echo "Verdaccio UID:GID = $VERDACCIO_UID:$VERDACCIO_GID"

# Проверяем существование директории
if [ ! -d "$STORAGE_DIR" ]; then
    echo "Creating storage directory..."
    mkdir -p "$STORAGE_DIR"
fi

# Исправляем права на корневую директорию
echo "Setting permissions on storage root..."
chown "$VERDACCIO_UID:$VERDACCIO_GID" "$STORAGE_DIR"
chmod 755 "$STORAGE_DIR"

# Исправляем права на все scope-директории (@org)
echo "Fixing permissions on scope directories..."
find "$STORAGE_DIR" -maxdepth 1 -type d -name "@*" -exec chown -R "$VERDACCIO_UID:$VERDACCIO_GID" {} \; 2>/dev/null || true
find "$STORAGE_DIR" -maxdepth 1 -type d -name "@*" -exec chmod -R 755 {} \; 2>/dev/null || true

# Исправляем права на все package директории внутри scopes
echo "Fixing permissions on package directories inside scopes..."
for scope_dir in "$STORAGE_DIR"/@*/; do
    if [ -d "$scope_dir" ]; then
        find "$scope_dir" -type d -exec chown "$VERDACCIO_UID:$VERDACCIO_GID" {} \; 2>/dev/null || true
        find "$scope_dir" -type f -exec chown "$VERDACCIO_UID:$VERDACCIO_GID" {} \; 2>/dev/null || true
        find "$scope_dir" -type d -exec chmod 755 {} \; 2>/dev/null || true
        find "$scope_dir" -type f -exec chmod 644 {} \; 2>/dev/null || true
    fi
done

# Исправляем права на обычные пакеты (не scoped)
echo "Fixing permissions on regular packages..."
for pkg_dir in "$STORAGE_DIR"/*/; do
    pkg_name=$(basename "$pkg_dir")
    # Пропускаем scope директории и скрытые файлы
    case "$pkg_name" in
        @*|.*) continue ;;
    esac
    if [ -d "$pkg_dir" ]; then
        chown -R "$VERDACCIO_UID:$VERDACCIO_GID" "$pkg_dir" 2>/dev/null || true
        find "$pkg_dir" -type d -exec chmod 755 {} \; 2>/dev/null || true
        find "$pkg_dir" -type f -exec chmod 644 {} \; 2>/dev/null || true
    fi
done

echo "=== Permissions initialization completed ==="
