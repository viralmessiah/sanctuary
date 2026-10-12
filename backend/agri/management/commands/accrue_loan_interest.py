from django.core.management.base import BaseCommand
from django.utils import timezone

from agri import finance


class Command(BaseCommand):
    help = "Accrue monthly simple interest on outstanding released loan principal."

    def handle(self, *args, **options):
        today = timezone.localdate()
        processed = finance.accrue_portfolio_interest(through_date=today)
        self.stdout.write(self.style.SUCCESS(f"Created {processed} interest accrual entries through {today}."))
