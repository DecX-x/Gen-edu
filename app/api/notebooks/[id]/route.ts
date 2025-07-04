import { NextRequest, NextResponse } from 'next/server';
import { AuthUtils } from '@/lib/auth/utils';
import dbConnect from '@/lib/database/mongodb';
import Notebook from '@/lib/models/Notebook';
import { ActivityTracker } from '@/lib/utils/activity-tracker';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify token
    const payload = AuthUtils.verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      );
    }

    await dbConnect();

    const { id } = await params
    const notebook = await Notebook.findOne({ 
      notebookId: id,
      $or: [
        { userId: payload.userId },
        { 'sharing.isPublic': true },
        { 'sharing.sharedWith': payload.userId }
      ]
    });

    if (!notebook) {
      return NextResponse.json(
        { success: false, message: 'Notebook not found' },
        { status: 404 }
      );
    }

    // Update view count if not the owner
    if (notebook.userId !== payload.userId) {
      notebook.stats.views += 1;
      await notebook.save();
    }

    return NextResponse.json({
      success: true,
      notebook
    });

  } catch (error) {
    console.error('Get notebook error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify token
    const payload = AuthUtils.verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      );
    }

    const updateData = await request.json();

    await dbConnect();

    const { id } = await params
    const notebook = await Notebook.findOne({ 
      notebookId: id,
      $or: [
        { userId: payload.userId },
        { 'sharing.sharedWith': payload.userId, 'sharing.permissions.canEdit': true }
      ]
    });

    if (!notebook) {
      return NextResponse.json(
        { success: false, message: 'Notebook not found or no edit permission' },
        { status: 404 }
      );
    }

    // Update allowed fields
    const allowedUpdates = ['title', 'description', 'cells', 'metadata', 'sharing'];
    
    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        if (key === 'cells' && Array.isArray(updateData[key])) {
          // Ensure cells have IDs
          notebook.cells = updateData[key].map((cell: any) => ({
            ...cell,
            id: cell.id || `cell_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          }));
        } else if (key === 'metadata' || key === 'sharing') {
          notebook[key] = { ...notebook[key], ...updateData[key] };
        } else {
          notebook[key] = updateData[key];
        }
      }
    });    notebook.lastSaved = new Date();
    notebook.version += 1;

    await notebook.save();

    // Track activity for notebook update
    try {
      const wordsWritten = notebook.cells.reduce((total: number, cell: any) => {
        if (cell.content && typeof cell.content === 'string') {
          return total + cell.content.split(/\s+/).filter((word: string) => word.length > 0).length;
        }
        return total;
      }, 0);      await ActivityTracker.trackActivity(payload.userId, 'notebook_updated', {
        title: `Updated notebook: ${notebook.title}`,
        description: `Made changes to ${notebook.title}`,
        metadata: {
          notebookId: id,
          cellsAdded: notebook.cells.length,
          wordsWritten: wordsWritten,
          sessionDuration: 5, // Approximate session duration in minutes
        }
      });
    } catch (activityError) {
      console.error('Error tracking activity:', activityError);
      // Don't fail the request if activity tracking fails
    }

    return NextResponse.json({
      success: true,
      message: 'Notebook updated successfully',
      notebook
    });

  } catch (error) {
    console.error('Update notebook error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get('auth-token')?.value;

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify token
    const payload = AuthUtils.verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, message: 'Invalid token' },
        { status: 401 }
      );
    }

    await dbConnect();

    const { id } = await params
    const notebook = await Notebook.findOneAndDelete({ 
      notebookId: id,
      userId: payload.userId // Only owner can delete
    });

    if (!notebook) {
      return NextResponse.json(
        { success: false, message: 'Notebook not found or no permission to delete' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Notebook deleted successfully'
    });

  } catch (error) {
    console.error('Delete notebook error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
