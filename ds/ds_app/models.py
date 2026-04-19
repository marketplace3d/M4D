"""
ds_app/models.py — ORM models for persisting backtest runs and signal records.
"""
from django.db import models


class BacktestRun(models.Model):
    """Persisted result of a backtest execution."""

    asset = models.CharField(max_length=20, db_index=True)
    algo = models.CharField(max_length=20, db_index=True)
    start_date = models.DateField()
    end_date = models.DateField()
    params = models.JSONField(default=dict)
    result = models.JSONField(default=dict)
    status = models.CharField(
        max_length=20,
        default="pending",
        choices=[
            ("pending", "Pending"),
            ("running", "Running"),
            ("done", "Done"),
            ("error", "Error"),
        ],
    )
    error_msg = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"BacktestRun({self.asset}/{self.algo} {self.start_date}→{self.end_date})"


class SignalRecord(models.Model):
    """A single algo vote persisted for a specific asset+timestamp."""

    asset = models.CharField(max_length=20, db_index=True)
    timestamp = models.DateTimeField(db_index=True)
    algo_id = models.CharField(max_length=20, db_index=True)
    vote = models.SmallIntegerField()   # -1, 0, or +1
    score = models.FloatField(default=0.0)
    reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["asset", "algo_id", "timestamp"]),
        ]

    def __str__(self):
        return f"Signal({self.asset}/{self.algo_id} {self.vote:+d} @ {self.timestamp})"
