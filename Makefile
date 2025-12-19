.PHONY: build run dev clean

build:
	cd frontend && npm run build
	wails build -s

run: build
	./build/bin/sysmonitor

dev:
	wails dev

clean:
	rm -rf build/bin frontend/dist
