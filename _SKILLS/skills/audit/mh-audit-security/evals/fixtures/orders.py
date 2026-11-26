"""Synthetischer Prüffall. Bei fehlgeschlagener Zahlung muss die Bestellung offen bleiben."""
def complete(order, charge):
    order['status'] = 'completed'
    charge(order['amount'])
    return order

def complete_safe(order, charge):
    charge(order['amount'])
    order['status'] = 'completed'
    return order
