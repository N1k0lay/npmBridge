#!/bin/bash

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 source_dir frozen_dir diff_dir"
  exit 1
fi

source_dir="$1"
frozen_dir="$2"
diff_dir="$3"
log_file="transfer.log"

source_dir="${source_dir%/}"
frozen_dir="${frozen_dir%/}"
diff_dir="${diff_dir%/}"

if [ ! -d "$source_dir" ]; then
  echo "Error: source_dir does not exist or is not a directory: $source_dir"
  exit 1
fi
if [ ! -d "$frozen_dir" ]; then
  echo "Error: frozen_dir does not exist or is not a directory: $frozen_dir"
  exit 1
fi

mkdir -p "$diff_dir"
echo "Перенос начался: $(date)" | tee -a "$log_file"

find "$source_dir" -type f | while read -r src_file; do
  rel_path="${src_file#$source_dir/}"
  frozen_file="$frozen_dir/$rel_path"
  diff_file="$diff_dir/$rel_path"
  diff_file_dir=$(dirname "$diff_file")
  mkdir -p "$diff_file_dir"

  if [ ! -f "$frozen_file" ]; then
    if cp "$src_file" "$diff_file"; then
      echo "$(date) NEW FILE: $rel_path скопирован" | tee -a "$log_file"
    else
      echo "$(date) ERROR: Failed to copy new file $rel_path" | tee -a "$log_file"
    fi
  else
    src_mod_time=$(stat -c %Y "$src_file")
    frozen_mod_time=$(stat -c %Y "$frozen_file")

    if [ "$src_mod_time" -gt "$frozen_mod_time" ]; then
      if cp "$src_file" "$diff_file"; then
        echo "$(date) UPDATED FILE: $rel_path скопирован" | tee -a "$log_file"
      else
        echo "$(date) ERROR: Failed to copy updated file $rel_path" | tee -a "$log_file"
      fi
    fi
  fi
done

echo "Перенос завершён: $(date)" | tee -a "$log_file"

