#!/usr/bin/env python3
"""
Скрипт создания diff между storage и frozen.
Создаёт архив с новыми/изменёнными файлами для переноса в корпоративную сеть.
"""

import os
import sys
import json
import tarfile
from datetime import datetime
from pathlib import Path
from threading import Lock

# Конфигурация
STORAGE_DIR = os.environ.get('STORAGE_DIR', './storage')
FROZEN_DIR = os.environ.get('FROZEN_DIR', './frozen')
DIFF_ARCHIVES_DIR = os.environ.get('DIFF_ARCHIVES_DIR', './diff_archives')
DIFF_ID = os.environ.get('DIFF_ID', f"diff_{datetime.now().strftime('%Y%m%d_%H%M%S')}")

# Файлы для отслеживания прогресса
PROGRESS_FILE = os.environ.get('PROGRESS_FILE', '/tmp/diff_progress.json')
STATUS_FILE = os.environ.get('STATUS_FILE', '/tmp/diff_status.json')
LOG_FILE = os.environ.get('LOG_FILE', '/tmp/diff.log')

log_lock = Lock()


def log(level: str, message: str):
    timestamp = datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    print(log_line, file=sys.stderr)
    with log_lock:
        try:
            with open(LOG_FILE, 'a') as f:
                f.write(log_line + '\n')
        except Exception:
            pass


def update_status(status: str, message: str):
    data = {
        "status": status,
        "message": message,
        "updatedAt": datetime.now().isoformat()
    }
    try:
        with open(STATUS_FILE, 'w') as f:
            json.dump(data, f)
    except Exception:
        pass


def update_progress(phase: str, current: int, total: int):
    percent = (current * 100 / total) if total > 0 else 0
    data = {
        "phase": phase,
        "current": current,
        "total": total,
        "percent": round(percent, 2),
        "updatedAt": datetime.now().isoformat()
    }
    try:
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(data, f)
    except Exception:
        pass


def get_diff_files() -> list[tuple[str, Path]]:
    """
    Получение списка файлов, которые отличаются между storage и frozen.
    Возвращает список кортежей (относительный_путь, полный_путь_в_storage)
    """
    storage_path = Path(STORAGE_DIR)
    frozen_path = Path(FROZEN_DIR)
    
    diff_files = []
    
    # Исключаем служебные файлы
    exclude_names = {'.sinopia-db.json', '.verdaccio-db.json', '.DS_Store'}
    
    for src_file in storage_path.rglob('*'):
        if src_file.is_dir():
            continue
        
        if src_file.name in exclude_names:
            continue
        
        rel_path = src_file.relative_to(storage_path)
        frozen_file = frozen_path / rel_path
        
        # Файл новый или изменённый
        if not frozen_file.exists():
            diff_files.append((str(rel_path), src_file))
        else:
            # Сравниваем по времени модификации
            src_mtime = src_file.stat().st_mtime
            frozen_mtime = frozen_file.stat().st_mtime
            if src_mtime > frozen_mtime:
                diff_files.append((str(rel_path), src_file))
    
    return diff_files


def format_size(size_bytes: int) -> str:
    """Форматирование размера файла"""
    size = float(size_bytes)
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024.0:
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{size:.2f} PB"


def main():
    log('INFO', f'Starting diff creation: {DIFF_ID}')
    update_status('running', 'Инициализация...')
    
    storage_path = Path(STORAGE_DIR)
    frozen_path = Path(FROZEN_DIR)
    archives_path = Path(DIFF_ARCHIVES_DIR)
    
    # Проверка директорий
    if not storage_path.exists():
        log('ERROR', f'Storage directory not found: {STORAGE_DIR}')
        update_status('failed', f'Директория storage не найдена')
        sys.exit(1)
    
    # Создаём frozen если не существует
    frozen_path.mkdir(parents=True, exist_ok=True)
    archives_path.mkdir(parents=True, exist_ok=True)
    
    # Получаем список файлов для diff
    log('INFO', 'Analyzing differences...')
    update_status('running', 'Анализ различий...')
    update_progress('analyzing', 0, 0)
    
    diff_files = get_diff_files()
    total_files = len(diff_files)
    
    if total_files == 0:
        log('INFO', 'No differences found between storage and frozen')
        update_status('completed', 'Различий не найдено')
        
        result = {
            "diffId": DIFF_ID,
            "filesCount": 0,
            "archivePath": None,
            "archiveSize": 0,
            "archiveSizeHuman": "0 B",
            "files": [],
            "storageSnapshotTime": datetime.now().isoformat()
        }
        print(json.dumps(result))
        sys.exit(0)
    
    log('INFO', f'Found {total_files} files to include in diff')
    update_status('running', f'Создание архива с {total_files} файлами...')
    
    # Создаём архив
    archive_path = archives_path / f"{DIFF_ID}.tar.gz"
    files_list_path = archives_path / f"{DIFF_ID}_files.json"
    
    files_info = []
    
    with tarfile.open(archive_path, 'w:gz') as tar:
        for i, (rel_path, src_file) in enumerate(diff_files, 1):
            update_progress('archiving', i, total_files)
            
            # Добавляем файл в архив
            tar.add(src_file, arcname=rel_path)
            
            # Сохраняем информацию о файле
            file_stat = src_file.stat()
            files_info.append({
                "path": rel_path,
                "size": file_stat.st_size,
                "mtime": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
            })
    
    # Получаем размер архива
    archive_size = archive_path.stat().st_size
    archive_size_human = format_size(archive_size)
    
    # Сохраняем список файлов
    with open(files_list_path, 'w') as f:
        json.dump(files_info, f, indent=2)
    
    log('INFO', f'Archive created: {archive_path} ({archive_size_human})')
    update_status('completed', f'Diff создан: {total_files} файлов, {archive_size_human}')
    
    # Возвращаем результат
    result = {
        "diffId": DIFF_ID,
        "filesCount": total_files,
        "archivePath": str(archive_path),
        "archiveSize": archive_size,
        "archiveSizeHuman": archive_size_human,
        "filesListPath": str(files_list_path),
        "files": [f["path"] for f in files_info],
        "storageSnapshotTime": datetime.now().isoformat()
    }
    print(json.dumps(result))


if __name__ == '__main__':
    main()
