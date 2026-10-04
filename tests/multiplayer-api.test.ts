import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { BASE_URL, resetDb, seedUserAndLogin } from './helpers/setup.ts';

function sessionToken(cookie: string): string {
  const token = /(?:^|;\s*)session=([^;]+)/.exec(cookie)?.[1];
  assert.ok(token, 'session cookie should contain a token');
  return decodeURIComponent(token);
}

function connectMultiplayer(roomId: string, gameId: string, cookie: string, requestedMaxPlayers = 99) {
  const url = new URL(`${BASE_URL}/api/ws/multiplayer`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('roomId', roomId);
  url.searchParams.set('gameId', gameId);
  url.searchParams.set('token', sessionToken(cookie));
  url.searchParams.set('maxPlayers', String(requestedMaxPlayers));

  const socket = new WebSocket(url);
  const opened = new Promise<boolean>((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (!accepted) {
        if (socket.readyState === WebSocket.OPEN) socket.close();
        else if (socket.readyState === WebSocket.CONNECTING)
          socket.addEventListener('open', () => socket.close(), { once: true });
      }
      resolve(accepted);
    };

    timeout = setTimeout(() => finish(false), 5000);
    socket.addEventListener('open', () => finish(true), { once: true });
    socket.addEventListener('error', () => finish(false), { once: true });
  });
  return { socket, opened };
}

async function closeWebSockets(sockets: WebSocket[]): Promise<void> {
  await Promise.all(
    sockets
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .map(
        (socket) =>
          new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, 1000);
            socket.addEventListener(
              'close',
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true },
            );
            socket.close();
          }),
      ),
  );
}

async function currentUserId(cookie: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

function waitForServerMessage(
  socket: WebSocket,
  predicate: (data: Record<string, unknown>) => boolean,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error('timed out waiting for server message'));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (predicate(data)) {
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage);
        resolve(data);
      }
    };
    socket.addEventListener('message', onMessage);
  });
}

async function createRoom(cookie: string, gameId: string, maxPlayers: number): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ gameId, maxPlayers }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { roomId: string }).roomId;
}

describe('POST /api/multiplayer/rooms', () => {
  beforeEach(resetDb);

  it('creates a room → 201', async () => {
    const { cookie } = await seedUserAndLogin('mp1');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'test-game', maxPlayers: 4, isPublic: true }),
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as Record<string, unknown>;
    assert.ok(data.roomId);
    assert.equal(data.gameId, 'test-game');
    assert.equal(data.maxPlayers, 4);
    assert.equal(data.isPublic, true);
  });

  it('creates a room with defaults → 201', async () => {
    const { cookie } = await seedUserAndLogin('mp2');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'default-game' }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    assert.equal(data.maxPlayers, 2);
    assert.equal(data.isPublic, true);
  });

  it('rejects missing gameId → 400', async () => {
    const { cookie } = await seedUserAndLogin('mp3');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'test' }),
    });
    assert.equal(res.status, 401);
  });

  it('rejects invalid JSON → 400', async () => {
    const { cookie } = await seedUserAndLogin('mp4');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: 'not-json',
    });
    assert.equal(res.status, 400);
  });
});

describe('WebSocket /api/ws/multiplayer', () => {
  beforeEach(resetDb);

  it('enforces the D1 room capacity instead of a client-supplied limit', async () => {
    const host = await seedUserAndLogin('ws-host');
    const second = await seedUserAndLogin('ws-second');
    const third = await seedUserAndLogin('ws-third');
    const fourth = await seedUserAndLogin('ws-fourth');
    const users = [host, second, third, fourth];
    const roomId = await createRoom(host.cookie, 'ws-capacity-three', 3);
    const openSockets: WebSocket[] = [];

    try {
      for (const [index, user] of users.entries()) {
        const attempt = connectMultiplayer(roomId, 'ws-capacity-three', user.cookie, 99);
        const accepted = await attempt.opened;
        if (accepted) openSockets.push(attempt.socket);
        assert.equal(accepted, index < 3, `connection ${index + 1} should respect a three-player room`);
      }
    } finally {
      await closeWebSockets(openSockets);
    }
  });

  it('keeps the runtime host bound to the recorded room host', async () => {
    const recordedHost = await seedUserAndLogin('ws-realhost');
    const earlyBird = await seedUserAndLogin('ws-earlybird');
    const recordedHostId = await currentUserId(recordedHost.cookie);
    const earlyBirdId = await currentUserId(earlyBird.cookie);
    const hostRoomId = await createRoom(recordedHost.cookie, 'ws-host-binding', 2);

    const early = connectMultiplayer(hostRoomId, 'ws-host-binding', earlyBird.cookie, 99);
    const earlyStatePromise = waitForServerMessage(early.socket, (data) => data.type === 'room_state');
    assert.equal(await early.opened, true);
    const earlyState = await earlyStatePromise;
    try {
      assert.equal((earlyState.room as { hostId: string }).hostId, recordedHostId);
      const earlyEntry = (earlyState.players as Array<{ userId: string; isHost: boolean }>).find(
        (player) => player.userId === earlyBirdId,
      );
      assert.ok(earlyEntry, 'the early connection should be listed as a player');
      assert.equal(earlyEntry.isHost, false);

      early.socket.send(JSON.stringify({ type: 'start_game' }));
      const denied = await waitForServerMessage(early.socket, (data) => data.type === 'error');
      assert.equal(denied.code, 'NOT_HOST');

      const late = connectMultiplayer(hostRoomId, 'ws-host-binding', recordedHost.cookie, 99);
      const lateStatePromise = waitForServerMessage(late.socket, (data) => data.type === 'room_state');
      assert.equal(await late.opened, true);
      const lateState = await lateStatePromise;
      try {
        const lateEntry = (lateState.players as Array<{ userId: string; isHost: boolean }>).find(
          (player) => player.userId === recordedHostId,
        );
        assert.ok(lateEntry, 'the recorded host should be listed as a player');
        assert.equal(lateEntry.isHost, true);
      } finally {
        await closeWebSockets([late.socket]);
      }
    } finally {
      await closeWebSockets([early.socket]);
    }
  });

  it('enforces the D1 room capacity for a single-player room', async () => {
    const host = await seedUserAndLogin('ws-single-host');
    const second = await seedUserAndLogin('ws-single-second');
    const singlePlayerRoomId = await createRoom(host.cookie, 'ws-capacity-one', 1);
    const singleRoomSockets: WebSocket[] = [];
    try {
      const first = connectMultiplayer(singlePlayerRoomId, 'ws-capacity-one', host.cookie, 99);
      const firstAccepted = await first.opened;
      if (firstAccepted) singleRoomSockets.push(first.socket);
      assert.equal(firstAccepted, true);

      const secondAttempt = connectMultiplayer(singlePlayerRoomId, 'ws-capacity-one', second.cookie, 99);
      const secondAccepted = await secondAttempt.opened;
      if (secondAccepted) singleRoomSockets.push(secondAttempt.socket);
      assert.equal(secondAccepted, false, 'a one-player room must reject a second connection');
    } finally {
      await closeWebSockets(singleRoomSockets);
    }
  });
});

describe('GET /api/multiplayer/rooms', () => {
  beforeEach(resetDb);

  it('lists public rooms → 200', async () => {
    const { cookie } = await seedUserAndLogin('mp5');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert.ok(Array.isArray(data.rooms));
  });

  it('filters by gameId', async () => {
    const { cookie } = await seedUserAndLogin('mp6');
    await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'filter-test' }),
    });
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms?gameId=filter-test`, {
      headers: { Cookie: cookie },
    });
    const data = (await res.json()) as Record<string, unknown>;
    const rooms = data.rooms as Array<Record<string, unknown>>;
    assert.ok(rooms.length >= 1);
    for (const room of rooms) {
      assert.equal(room.game_id, 'filter-test');
    }
  });

  it('filters by status', async () => {
    const { cookie } = await seedUserAndLogin('mp7');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms?status=playing`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms`);
    assert.equal(res.status, 401);
  });
});

describe('GET /api/multiplayer/rooms/:id', () => {
  beforeEach(resetDb);

  it('returns room details → 200', async () => {
    const { cookie } = await seedUserAndLogin('mp8');
    const createRes = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'detail-test' }),
    });
    const { roomId } = (await createRes.json()) as { roomId: string };

    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms/${roomId}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert.ok(data.room);
    assert.equal((data.room as Record<string, unknown>).id, roomId);
    assert.ok(Array.isArray(data.participants));
  });

  it('returns 404 for non-existent room', async () => {
    const { cookie } = await seedUserAndLogin('mp9');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms/nonexistent`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 404);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms/fake`);
    assert.equal(res.status, 401);
  });
});

describe('POST /api/multiplayer/rooms/:id/join', () => {
  beforeEach(resetDb);

  it('joins an existing room → 200', async () => {
    const { cookie: hostCookie } = await seedUserAndLogin('host');
    const createRes = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: hostCookie },
      body: JSON.stringify({ gameId: 'join-test' }),
    });
    const { roomId } = (await createRes.json()) as { roomId: string };

    const { cookie: joinerCookie } = await seedUserAndLogin('joiner');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { Cookie: joinerCookie },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert.ok(data.success);
    assert.equal(data.roomId, roomId);
    assert.ok(typeof data.wsUrl === 'string');
  });

  it('returns 404 for non-existent room', async () => {
    const { cookie } = await seedUserAndLogin('mp10');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms/nonexistent/join`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 404);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms/fake/join`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('allows multiple players to join', async () => {
    const { cookie: hostCookie } = await seedUserAndLogin('mhost');
    const createRes = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: hostCookie },
      body: JSON.stringify({ gameId: 'multi-join', maxPlayers: 3 }),
    });
    const { roomId } = (await createRes.json()) as { roomId: string };

    const { cookie: p2 } = await seedUserAndLogin('mp2nd');
    const res2 = await fetch(`${BASE_URL}/api/multiplayer/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { Cookie: p2 },
    });
    assert.equal(res2.status, 200);

    const { cookie: p3 } = await seedUserAndLogin('mp3rd');
    const res3 = await fetch(`${BASE_URL}/api/multiplayer/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { Cookie: p3 },
    });
    assert.equal(res3.status, 200);
  });
});

describe('POST /api/multiplayer/rooms/:id/leave', () => {
  beforeEach(resetDb);

  it('leaves a room → 200', async () => {
    const { cookie } = await seedUserAndLogin('mp11');
    const createRes = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'leave-test' }),
    });
    const { roomId } = (await createRes.json()) as { roomId: string };

    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms/${roomId}/leave`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert.ok(data.success);
  });
});

describe('POST /api/multiplayer/scores', () => {
  beforeEach(resetDb);

  it('submits a score → 201', async () => {
    const { cookie } = await seedUserAndLogin('mp12');
    const res = await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'score-game', score: 1000, label: 'Level 1' }),
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as Record<string, unknown>;
    assert.equal(data.score, 1000);
    assert.equal(data.label, 'Level 1');
  });

  it('submits score with metadata → 201', async () => {
    const { cookie } = await seedUserAndLogin('mp13');
    const res = await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'meta-game', score: 500, metadata: { level: 3, time: 120 } }),
    });
    assert.equal(res.status, 201);
  });

  it('rejects invalid score (NaN) → 400', async () => {
    const { cookie } = await seedUserAndLogin('mp14');
    const res = await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'bad', score: 'abc' }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects missing gameId → 400', async () => {
    const { cookie } = await seedUserAndLogin('mp15');
    const res = await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ score: 100 }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'g', score: 100 }),
    });
    assert.equal(res.status, 401);
  });
});

describe('GET /api/multiplayer/scores/:gameId', () => {
  beforeEach(resetDb);

  it('returns leaderboard → 200', async () => {
    const { cookie } = await seedUserAndLogin('mp16');
    await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'lb-game', score: 100 }),
    });

    const res = await fetch(`${BASE_URL}/api/multiplayer/scores/lb-game`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert.ok(Array.isArray(data.scores));
  });

  it('returns empty list for game with no scores', async () => {
    const res = await fetch(`${BASE_URL}/api/multiplayer/scores/nonexistent-game`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { scores: unknown[] };
    assert.deepStrictEqual(data.scores, []);
  });

  it('filters by userId', async () => {
    const { cookie } = await seedUserAndLogin('mp17');
    await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'filter-lb', score: 200 }),
    });

    const res = await fetch(`${BASE_URL}/api/multiplayer/scores/filter-lb?userId=mp17`);
    assert.equal(res.status, 200);
  });

  it('scores are ordered descending', async () => {
    const { cookie: c1 } = await seedUserAndLogin('ms1');
    const { cookie: c2 } = await seedUserAndLogin('ms2');

    await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: c1 },
      body: JSON.stringify({ gameId: 'order-game', score: 50 }),
    });
    await fetch(`${BASE_URL}/api/multiplayer/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: c2 },
      body: JSON.stringify({ gameId: 'order-game', score: 200 }),
    });

    const res = await fetch(`${BASE_URL}/api/multiplayer/scores/order-game`);
    const data = (await res.json()) as { scores: Array<{ score: number }> };
    assert.ok(data.scores[0].score >= data.scores[1].score);
  });
});

describe('POST /api/multiplayer/matchmaking', () => {
  beforeEach(resetDb);

  it('joins matchmaking queue → 200', async () => {
    const { cookie } = await seedUserAndLogin('mm1');
    const res = await fetch(`${BASE_URL}/api/multiplayer/matchmaking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'mm-game', action: 'join' }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    assert.ok(data.status === 'queued' || data.status === 'already_in_queue');
  });

  it('leaves matchmaking queue → 200', async () => {
    const { cookie } = await seedUserAndLogin('mm2');
    const res = await fetch(`${BASE_URL}/api/multiplayer/matchmaking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'mm-game2', action: 'leave' }),
    });
    assert.equal(res.status, 200);
  });

  it('checks matchmaking → 200', async () => {
    const { cookie } = await seedUserAndLogin('mm3');
    const res = await fetch(`${BASE_URL}/api/multiplayer/matchmaking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'mm-game3', action: 'check' }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as Record<string, unknown>;
    // With only one player in queue, should not match
    assert.equal(data.matched, false);
  });

  it('does not let an outsider consume queued matches', async () => {
    const first = await seedUserAndLogin('mm-theft-a');
    const second = await seedUserAndLogin('mm-theft-b');
    const outsider = await seedUserAndLogin('mm-theft-c');
    const gameId = 'mm-theft-game';
    const join = async (cookie: string) => {
      const res = await fetch(`${BASE_URL}/api/multiplayer/matchmaking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ gameId, action: 'join' }),
      });
      assert.equal(res.status, 200);
    };
    const check = async (cookie: string) => {
      const res = await fetch(`${BASE_URL}/api/multiplayer/matchmaking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ gameId, action: 'check' }),
      });
      assert.equal(res.status, 200);
      return (await res.json()) as { matched: boolean; players?: Array<{ userId: string }> };
    };

    await join(first.cookie);
    await join(second.cookie);

    const stolen = await check(outsider.cookie);
    assert.equal(stolen.matched, false);

    const legitimate = await check(first.cookie);
    assert.equal(legitimate.matched, true);
    const matchedIds = (legitimate.players ?? []).map((player) => player.userId).sort();
    assert.deepEqual(matchedIds, [await currentUserId(first.cookie), await currentUserId(second.cookie)].sort());
  });

  it('rejects missing gameId → 400', async () => {
    const { cookie } = await seedUserAndLogin('mm4');
    const res = await fetch(`${BASE_URL}/api/multiplayer/matchmaking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'join' }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects unknown action → 400', async () => {
    const { cookie } = await seedUserAndLogin('mm5');
    const res = await fetch(`${BASE_URL}/api/multiplayer/matchmaking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'mm-game5', action: 'unknown' }),
    });
    assert.equal(res.status, 400);
  });

  it('rejects unauthenticated → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/multiplayer/matchmaking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: 'g', action: 'join' }),
    });
    assert.equal(res.status, 401);
  });
});

describe('POST /api/multiplayer/rooms/:id/join — error cases', () => {
  beforeEach(resetDb);

  it('returns 400 when joining a room that is playing', async () => {
    const { cookie } = await seedUserAndLogin('err1');
    const createRes = await fetch(`${BASE_URL}/api/multiplayer/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ gameId: 'err-game', maxPlayers: 1 }),
    });
    const { roomId } = (await createRes.json()) as { roomId: string };

    // When maxPlayers=1, second join would be rejected
    const { cookie: err2 } = await seedUserAndLogin('err2');
    const res = await fetch(`${BASE_URL}/api/multiplayer/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { Cookie: err2 },
    });
    assert.equal(res.status, 400);
  });
});
