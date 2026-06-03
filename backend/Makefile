.PHONY: help build run test clean deps dev

help:
	@echo "Available commands:"
	@echo "  make build       - Build the application"
	@echo "  make run         - Run the application"
	@echo "  make test        - Run tests"
	@echo "  make clean       - Clean build artifacts"
	@echo "  make deps        - Download dependencies"
	@echo "  make dev         - Run in development mode"

deps:
	@echo "Downloading dependencies..."
	go mod download
	go mod tidy

build:
	@echo "Building application..."
	go build -o bin/liyah-funnel ./cmd/funnel

run: build
	@echo "Running application..."
	./bin/liyah-funnel

dev:
	@echo "Running in development mode..."
	go run ./cmd/funnel/main.go

test:
	@echo "Running tests..."
	go test ./... -v

clean:
	@echo "Cleaning up..."
	rm -rf bin/
	go clean
