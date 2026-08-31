#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 EvoRule Project
# macOS 双击启动入口(等效 sh start-evorule.sh;停止用 sh stop-evorule.sh)
cd "$(dirname "$0")"
exec sh start-evorule.sh
