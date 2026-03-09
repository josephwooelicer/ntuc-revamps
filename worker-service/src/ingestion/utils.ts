export function getSGTDate(date: Date): Date {
    // SGT is UTC+8
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 8));
}

export function normalizeRangeToSgtDayBounds(start: Date, end: Date) {
    const startSgt = getSGTComponents(start);
    const endSgt = getSGTComponents(end);
    const normalizedStart = fromSGT(startSgt.year, startSgt.month, startSgt.day, 0, 0, 0);
    const normalizedEnd = fromSGT(endSgt.year, endSgt.month, endSgt.day, 23, 59, 59);
    return { start: normalizedStart, end: normalizedEnd };
}

export function splitRangeByMonthInSgt(start: Date, end: Date): Array<{ start: Date; end: Date }> {
    const startSgt = getSGTComponents(start);
    const endSgt = getSGTComponents(end);
    const result: Array<{ start: Date; end: Date }> = [];

    let year = startSgt.year;
    let month = startSgt.month;

    while (year < endSgt.year || (year === endSgt.year && month <= endSgt.month)) {
        const monthStart = fromSGT(year, month, 1, 0, 0, 0);
        const nextMonthYear = month === 12 ? year + 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        const monthEnd = new Date(fromSGT(nextMonthYear, nextMonth, 1, 0, 0, 0).getTime() - 1000);

        const boundedStart = monthStart < start ? start : monthStart;
        const boundedEnd = monthEnd > end ? end : monthEnd;
        if (boundedStart <= boundedEnd) {
            result.push({ start: boundedStart, end: boundedEnd });
        }

        year = nextMonthYear;
        month = nextMonth;
    }

    return result;
}

export function toSGT(date: Date): Date {
    // Treat the incoming Date as UTC and shift it to SGT representation
    return new Date(date.getTime() + (8 * 60 * 60 * 1000));
}

export function fromSGT(year: number, month: number, day: number, hour: number = 0, minute: number = 0, second: number = 0): Date {
    // Create a Date object representing the given SGT time in UTC
    // e.g. 2025-05-01 00:00:00 SGT is 2025-04-30 16:00:00 UTC
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return new Date(date.getTime() - (8 * 60 * 60 * 1000));
}

export function getSGTComponents(date: Date) {
    const sgtDate = new Date(date.getTime() + (8 * 60 * 60 * 1000));
    return {
        year: sgtDate.getUTCFullYear(),
        month: sgtDate.getUTCMonth() + 1,
        day: sgtDate.getUTCDate(),
        hour: sgtDate.getUTCHours(),
        minute: sgtDate.getUTCMinutes(),
        second: sgtDate.getUTCSeconds(),
        isoDate: sgtDate.toISOString().split('T')[0],
        yyyymm: `${sgtDate.getUTCFullYear()}${(sgtDate.getUTCMonth() + 1).toString().padStart(2, '0')}`
    };
}
