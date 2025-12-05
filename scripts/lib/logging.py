"""
Модуль логирования для скриптов обновления.

Обеспечивает потокобезопасное логирование в файл и stdout.
"""

import json
from datetime import datetime
from threading import Lock

from .config import LOG_FILE, STATUS_FILE, PROGRESS_FILE

_log_lock = Lock()


def log(level: str, message: str) -> None:
    """
    Записывает сообщение в лог-файл и выводит в stdout.
    
    Args:
        level: Уровень логирования (INFO, ERROR, WARN)
        message: Текст сообщения
    """
    timestamp = datetime.now().isoformat()
    log_line = f"[{timestamp}] [{level}] {message}"
    print(log_line, flush=True)
    
    with _log_lock:
        try:
            with open(LOG_FILE, 'a') as f:
                f.write(log_line + '\n')
        except Exception:
            pass


def update_status(status: str, message: str) -> None:
    """
    Обновляет файл статуса задачи.
    
    Args:
        status: Статус (running, completed, failed, completed_with_errors)
        message: Описание текущего состояния
    """
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


def update_progress(
    current: int,
    total: int,
    package: str,
    success: int,
    failed: int,
    errors: list
) -> None:
    """
    Обновляет файл прогресса выполнения.
    
    Args:
        current: Текущий обработанный пакет (номер)
        total: Общее количество пакетов
        package: Имя текущего пакета
        success: Количество успешно обновлённых
        failed: Количество с ошибками
        errors: Список ошибок [{package, error}, ...]
    """
    percent = (current * 100 / total) if total > 0 else 100
    data = {
        "current": current,
        "total": total,
        "success": success,
        "failed": failed,
        "currentPackage": package,
        "percent": round(percent, 2),
        "errors": errors[-20:],  # Последние 20 ошибок
        "updatedAt": datetime.now().isoformat()
    }
    try:
        with open(PROGRESS_FILE, 'w') as f:
            json.dump(data, f)
    except Exception:
        pass
