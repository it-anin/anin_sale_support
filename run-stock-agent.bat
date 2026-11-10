@echo off
title ANIN Stock Agent
chcp 65001 > nul
cd /d "%~dp0"
:restart
echo Starting Stock Agent...
node stock-agent.mjs
echo Agent stopped. Restarting in 10 seconds...
ping -n 11 127.0.0.1 > nul
goto restart
