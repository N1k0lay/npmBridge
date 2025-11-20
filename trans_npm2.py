#!/usr/bin/env python3
import os
import shutil
import time
from pathlib import Path
import sys
from multiprocessing import Pool

def process_file(args):
    src_file, source_dir, frozen_dir, diff_dir, log_queue = args
    rel_path = str(Path(src_file).relative_to(source_dir))
    frozen_file = frozen_dir / rel_path
    diff_file = diff_dir / rel_path
    # Создаем директорию для diff_file, если её нет
    diff_file.parent.mkdir(parents=True, exist_ok=True)
    if not frozen_file.exists():
        shutil.copy2(src_file, diff_file)
        return f"{time.ctime()} NEW FILE: {rel_path} скопирован"
    else:
        src_mtime = Path(src_file).stat().st_mtime
        frozen_mtime = Path(frozen_file).stat().st_mtime
        if src_mtime > frozen_mtime:
            shutil.copy2(src_file, diff_file)
            return f"{time.ctime()} UPDATED FILE: {rel_path} скопирован"
    return None

def remove_empty_dirs(path: Path):
    # Рекурсивно обходит каталоги снизу вверх и удаляет пустые папки
    for subdir in sorted(path.glob('**/*'), key=lambda p: -len(p.parts)):
        if subdir.is_dir():
            try:
                if not any(subdir.iterdir()):
                    subdir.rmdir()
            except Exception as e:
                print(f"Ошибка удаления папки {subdir}: {e}")

def main():
    if len(sys.argv) != 4:
        print("Usage: ./script.py source_dir frozen_dir diff_dir")
        sys.exit(1)

    source_dir = Path(sys.argv[1])
    frozen_dir = Path(sys.argv[2])
    diff_dir = Path(sys.argv[3])

    log_file = "transfer.log"

    if not source_dir.is_dir():
        print(f"Error: source_dir does not exist or is not a directory: {source_dir}")
        sys.exit(1)
    if not frozen_dir.is_dir():
        print(f"Error: frozen_dir does not exist or is not a directory: {frozen_dir}")
        sys.exit(1)

    diff_dir.mkdir(parents=True, exist_ok=True)

    with open(log_file, 'a') as log:
        message = f"Перенос начался: {time.ctime()}\n"
        log.write(message)
        print(message, end='')  # Вывод на экран

    files = list(source_dir.rglob('*'))
    files = [f for f in files if f.is_file()]
    args_list = [(str(f), source_dir, frozen_dir, diff_dir, None) for f in files]

    with Pool() as pool:
        results = pool.map(process_file, args_list)

    with open(log_file, 'a') as log:
        for result in results:
            if result:
                log.write(result + "\n")
                print(result)  # Вывод на экран
        message = f"Перенос завершён: {time.ctime()}\n"
        log.write(message)
        print(message, end='')  # Вывод на экран

    # Удаляем пустые папки рекурсивно после копирования
    remove_empty_dirs(diff_dir)

if __name__ == "__main__":
    main()

