FROM ollama/ollama:latest
ENV OLLAMA_HOST=0.0.0.0:8080
# Pre-load the model so it's fast at the event
RUN nohup bash -c "ollama serve &" && sleep 10 && ollama pull gemma:2b