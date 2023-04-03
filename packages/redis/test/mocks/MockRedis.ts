export class MockRedis {
  public _instance = {
    set: jest.fn(async (_: any) => {
      return true
    }),

    deleteIfEqual: jest.fn(async (_: any) => {
      return true
    }),

    refreshIfEqual: jest.fn(async (_: any) => {
      return true
    })
  }

  instance () {
    return this._instance
  }
}
