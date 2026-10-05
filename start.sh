#!/usr/bin/env bash
cd "$(dirname "$0")"
exec npm --prefix apps/web run dev
