
# Distributed Rate Limiter & Security Gateway

A high-performance rate-limiting gateway built with **TypeScript**, **Node.js (Express)**, and **Redis**.

## Core Features

* **Atomic Sliding Window Counter**: Uses Redis Lua scripts to provide strict state consistency and zero race conditions.
* **Robust Circuit Breaker**: Allows for falling back to an in-memory fixed window cache during Redis downtime for full-time protection,
* **Penalty Box System**: Temporarily blocks IP addresses that repeatedly trigger `429 Too Many Requests` responses.

---

## Getting Started

### Prerequisites

* **Node.js** 
* **Docker** (for local Redis)

### 1. Installation

```
git clone https://github.com/gabriellemaciunaite/rate-limiter.git
cd rate-limiter
npm install

```

### 2. Start Redis Container

```
sudo docker run -d -p 6379:6379 --name limiter-redis redis:alpine

```

### 3. Run Development Server

The server can be accessed at [http://127.0.0.1:3000](http://127.0.0.1:3000):

```
npx tsx server.ts

```

---

## Testing Utilities

### Run Tests

Execute the test suite using Vitest:

```
npx vitest run

```

### Manually Clear Blocked IPs / Strikes

To flush all rate limits and active bans from your local Redis instance during testing:

```
sudo docker exec -it limiter-redis redis-cli FLUSHALL

```
