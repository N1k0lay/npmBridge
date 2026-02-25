import { NextResponse } from 'next/server';
import {
  loadNetworks,
  addNetwork,
  updateNetwork,
  deleteNetwork,
  loadNetworkStates,
} from '@/lib/networks';

// GET - получить список сетей и их состояния
export async function GET() {
  try {
    const [networks, states] = await Promise.all([
      loadNetworks(),
      loadNetworkStates(),
    ]);

    const networksWithStates = networks.map(network => ({
      ...network,
      state: states[network.id] || {
        networkId: network.id,
        lastSyncAt: null,
        lastDiffId: null,
        packagesCount: 0,
        totalSize: 0,
      },
    }));

    return NextResponse.json({
      networks: networksWithStates,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка получения списка сетей', details: String(error) },
      { status: 500 }
    );
  }
}

// POST - создать новую сеть
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, color } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Название сети обязательно' },
        { status: 400 }
      );
    }

    const network = await addNetwork({
      name,
      description: description || '',
      color: color || '#6B7280',
    });

    return NextResponse.json({ network });
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка создания сети', details: String(error) },
      { status: 500 }
    );
  }
}

// PUT - обновить сеть
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID сети обязателен' },
        { status: 400 }
      );
    }

    const success = await updateNetwork(id, updates);

    if (!success) {
      return NextResponse.json(
        { error: 'Сеть не найдена' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка обновления сети', details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE - удалить сеть
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID сети обязателен' },
        { status: 400 }
      );
    }

    if (id === 'default') {
      return NextResponse.json(
        { error: 'Нельзя удалить основную сеть' },
        { status: 400 }
      );
    }

    const success = await deleteNetwork(id);

    if (!success) {
      return NextResponse.json(
        { error: 'Сеть не найдена' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка удаления сети', details: String(error) },
      { status: 500 }
    );
  }
}
