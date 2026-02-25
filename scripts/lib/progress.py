"""
Модуль для отслеживания прогресса многопоточных операций.

Предоставляет потокобезопасный класс для учёта прогресса обновления пакетов.
"""

from threading import Lock
from .logging import update_progress


class ProgressTracker:
    """
    Потокобезопасный трекер прогресса обновления пакетов.
    
    Используется для учёта успешных и неуспешных обновлений
    при параллельной обработке пакетов.
    """
    
    def __init__(self, total: int, update_interval: int = 10):
        """
        Инициализация трекера.
        
        Args:
            total: Общее количество пакетов для обработки
            update_interval: Интервал обновления файла прогресса (в пакетах)
        """
        self.current = 0
        self.total = total
        self.current_package = ""
        self.success = 0
        self.failed = 0
        self.errors: list[dict] = []
        self.update_interval = update_interval
        self._lock = Lock()
    
    def increment(self, package: str, success: bool, error_msg: str = "") -> None:
        """
        Увеличивает счётчик обработанных пакетов.
        
        Args:
            package: Имя обработанного пакета
            success: True если обновление успешно
            error_msg: Сообщение об ошибке (если success=False)
        """
        with self._lock:
            self.current += 1
            self.current_package = package
            
            if success:
                self.success += 1
            else:
                self.failed += 1
                self.errors.append({
                    "package": package,
                    "error": error_msg[:500]
                })
            
            # Обновляем файл прогресса периодически или в конце
            if self.current % self.update_interval == 0 or self.current == self.total:
                self._write_progress()
    
    def _write_progress(self) -> None:
        """Записывает текущий прогресс в файл."""
        update_progress(
            current=self.current,
            total=self.total,
            package=self.current_package,
            success=self.success,
            failed=self.failed,
            errors=self.errors
        )
    
    def force_update(self) -> None:
        """Принудительно обновляет файл прогресса."""
        with self._lock:
            self._write_progress()
