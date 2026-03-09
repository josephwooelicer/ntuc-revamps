export function getSGTDate(date: Date): Date {
    // SGT is UTC+8
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 8));
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
