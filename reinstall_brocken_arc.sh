#!/bin/bash

# Файл с поврежденными архивами
BROKEN_FILE="broken.txt"

# Проверка наличия файла с поврежденными архивами
if [ ! -f "$BROKEN_FILE" ]; then
    echo "Файл с поврежденными архивами не найден: $BROKEN_FILE"
    exit 1
fi

# Удаление поврежденных архивов и установка пакетов
if [ -s "$BROKEN_FILE" ]; then
    echo "Удаление поврежденных архивов и установка пакетов..."
    while IFS= read -r archive; do
        # Удаление поврежденного архива
        rm "$archive"

        # Извлечение имени пакета и версии из пути архива
        package_name=$(basename "$archive" | sed 's/-[0-9]\+\.[0-9]\+\.[0-9]\+.tgz$//')
        version=$(basename "$archive" | sed 's/^.*-//' | sed 's/.tgz$//')

        # Извлечение alias пакета, если он есть
        package_alias=$(dirname "$archive" | grep -oP '@\K[^/]+')

        # Установка пакета во временную папку
        temp_install_dir=$(mktemp -d)
        if [ -n "$package_alias" ]; then
            npm install -f "@$package_alias/$package_name@$version" --prefix "$temp_install_dir"
            echo "Пакет @$package_alias/$package_name@$version установлен в $temp_install_dir"
        else
            npm install -f "$package_name@$version" --prefix "$temp_install_dir"
            echo "Пакет $package_name@$version установлен в $temp_install_dir"
        fi

        # Проверка архива после установки пакета
        if tar -tzf "$archive" > /dev/null 2>&1; then
            echo "Архив $archive успешно проверен после установки пакета."
        else
            echo "Архив $archive поврежден после установки пакета."
        fi
    done < "$BROKEN_FILE"
else
    echo "Нет поврежденных архивов для удаления и установки."
fi

