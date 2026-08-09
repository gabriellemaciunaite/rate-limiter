# Distributed Rate Limiter & Security Gateway

A rate-limiting software built with **TypeScript**, **Node.js (Express)**, and **Redis**. This program implements a **Sliding Window Counter algorithm** via atomic Redis Lua scripts to guarantee strict state consistency without race conditions. A Circuit Breaker is also implemented alongside an **in-memory fallback cache** for zero-downtime during Redis outages (using a fixed window algorithm), and a **Penalty Box** system that temporarily bans clients after repeated HTTP 429 (Too Many Requests) responses..

---

## Getting Started

### Prerequisites

* **Node.js** (v18 or higher)
* **Docker** (for running Redis locally)

### 1. Clone & Install Dependencies

```
git clone https://github.com/gabriellemaciunaite/rate-limiter.git
cd rate-limiter
npm install
```

### 2. Start Redis Container

```
sudo docker run -d -p 6379:6379 --name limiter-redis redis:alpine

```

### 3. Run the Development Server
The server will start at [http://127.0.0.1:3000](http://127.0.0.1:3000).
```
npx ts-node app.ts

```

---

### Unbanning an IP manually

To clear strikes and blocklists from Redis during local testing:

```
docker exec -it limiter-redis redis-cli FLUSHALL

```
