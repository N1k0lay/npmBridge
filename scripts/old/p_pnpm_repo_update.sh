#!/bin/bash

unset HTTPS_PROXY HTTP_PROXY http_proxy https_proxy

#директория с пакетами и временная установочная (может быть переопределено переменной окружения)
VERDACCIO_HOME="${VERDACCIO_HOME:-/home/npm/verdaccio}"
PNPM_CMD="${PNPM_CMD:-pnpm}"
NPM_INSTALL_DIR="$VERDACCIO_HOME/shit"

#переходим в директорию с пакетами
function cdVerdaccioHome ()
{
  if [ -d $VERDACCIO_HOME ];
    then
      cd $VERDACCIO_HOME
    else
      #если её нет - то выдаем сообщение и выходим
      echo "$VERDACCIO_HOME - does not exist."
      exit 1
  fi
}

#махинации с директорией с временной директорией
function cleanVerdaccioInstallDir ()
{
  if [ -d $NPM_INSTALL_DIR ];
    then
      #удаляем её
      #создаём её и заходим туда
      rm -rf $NPM_INSTALL_DIR
      mkdir $NPM_INSTALL_DIR && cd $NPM_INSTALL_DIR
    else
      #если её нет - то создаём её и заходим туда
      mkdir $NPM_INSTALL_DIR && cd $NPM_INSTALL_DIR
  fi
}

#переходим в директорию с пакетами
cdVerdaccioHome

#получаем список пактов @ и обычных
NPM_GROUP_PKG_LIST=$(ls -R storage/* | grep storage | tr -d ":" | sed {s/"storage\/"//} | grep "^@.*[!/]")
NPM_PKG_LIST=$(ls -R storage/* | grep storage | tr -d ":" | sed {s/"storage\/"//} | grep -v "^@")

#объединяем списки пакетов
ALL_PKG_LIST="$NPM_GROUP_PKG_LIST $NPM_PKG_LIST"

#функция для установки пакета
function installPackage ()
{
  local package=$1
  local temp_dir=$(mktemp -d)

  #переходим в временную директорию
  cd $temp_dir

  echo -e "\033[32mINSTALL\033[00m: $package"
  $PNPM_CMD install $package@latest --force

  #удаляем временную директорию
  cd $VERDACCIO_HOME
  rm -rf $temp_dir
}

#экспортируем функции и переменные для использования в parallel
export -f installPackage
export VERDACCIO_HOME

#выполняем установку пакетов параллельно
echo "$ALL_PKG_LIST" | tr ' ' '\n' | parallel -j 40 installPackage {}
