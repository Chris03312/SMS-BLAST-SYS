package com.flashsms.gateway;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.List;

public class LogAdapter extends RecyclerView.Adapter<LogAdapter.ViewHolder> {

    private List<MessageLog.Entry> items;

    public LogAdapter(List<MessageLog.Entry> items) {
        this.items = items;
    }

    public void update(List<MessageLog.Entry> newItems) {
        this.items = newItems;
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                     .inflate(R.layout.item_log, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder h, int pos) {
        MessageLog.Entry e = items.get(pos);
        h.tvTo.setText(e.to);
        h.tvMessage.setText(e.message);
        h.tvMeta.setText((e.flash ? "⚡ Flash" : "✉ Regular") + "  ·  " + e.note);
        h.tvTime.setText(e.timestamp);
        h.tvStatus.setText(e.status.equals("ok") ? "✓" : "✗");
        h.tvStatus.setTextColor(e.status.equals("ok")
            ? 0xFF4CAF50   // green
            : 0xFFF44336); // red
    }

    @Override
    public int getItemCount() { return items.size(); }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvStatus, tvTo, tvMessage, tvMeta, tvTime;
        ViewHolder(View v) {
            super(v);
            tvStatus  = v.findViewById(R.id.tvStatus);
            tvTo      = v.findViewById(R.id.tvTo);
            tvMessage = v.findViewById(R.id.tvMessage);
            tvMeta    = v.findViewById(R.id.tvMeta);
            tvTime    = v.findViewById(R.id.tvTime);
        }
    }
}
