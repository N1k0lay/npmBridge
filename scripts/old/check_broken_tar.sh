#!/bin/bash

# Файл для записи поврежденных архивов
BROKEN_FILE="broken.txt"

# Очистка файла с поврежденными архивами
> "$BROKEN_FILE"

# Поиск всех .tgz файлов в текущей директории и поддиректориях
ARCHIVES=$(find ./storage -type f -name "*.tgz")

# Инициализация счетчиков
total_archives=0
broken_archives=0

# Проверка каждого архива
for archive in $ARCHIVES; do
    total_archives=$((total_archives + 1))
    if ! tar -tzf "$archive" > /dev/null 2>&1; then
        echo "$archive" >> "$BROKEN_FILE"
        broken_archives=$((broken_archives + 1))
    fi
    echo -e "\rОбработано архивов: $total_archives, Поврежденных архивов: $broken_archives"
done

echo ""
echo "Проверка завершена. Поврежденные архивы записаны в $BROKEN_FILE"
echo "Всего обработано архивов: $total_archives"
echo "Поврежденных архивов: $broken_archives"

